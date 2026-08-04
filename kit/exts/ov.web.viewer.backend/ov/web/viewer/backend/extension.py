import asyncio
import json

import carb
import carb.eventdispatcher
import carb.events
import omni.ext
import omni.kit.app
import omni.kit.livestream.messaging as messaging
import omni.kit.viewport.utility
import omni.usd
import websockets

from isaacsim.storage.native import get_assets_root_path
from pxr import Gf, UsdGeom


class WebViewerBackendExtension(omni.ext.IExt):
    """Application API exposed over the WebRTC data channel."""

    def on_startup(self, ext_id: str):
        self._ext_id = ext_id
        self._handlers = []
        self._request_handlers = {}
        self._legacy_response_events = []
        self._legacy_messaging = not hasattr(messaging, "observe_and_dispatch")
        self._tasks = set()
        self._lift_tasks = {}
        self._lifted_paths = set()
        self._ws_clients = set()
        self._ws_server = None
        self._suppressed_selection_path = None
        self._usd_context = omni.usd.get_context()
        self._last_stage_url = self._current_stage_url()

        settings = carb.settings.get_settings()
        settings.set("/app/viewport/defaults/hud/visible", False)
        self._schedule(self._hide_viewport_hud())

        self._register_request("viewer:get-stage", self._get_stage)
        self._register_request("viewer:get-children", self._get_children)
        self._register_request("viewer:open-stage", self._open_stage)
        self._register_request("viewer:reload-stage", self._reload_stage)
        self._register_request("viewer:select-prim", self._select_prim)

        if self._legacy_messaging:
            self._schedule(self._start_legacy_websocket())

        messaging.register_event_type_to_send("viewer:selection-changed")
        messaging.register_event_type_to_send("viewer:stage-changed")
        messaging.register_event_type_to_send("viewer:interaction")

        dispatcher = carb.eventdispatcher.get_eventdispatcher()
        self._selection_subscription = dispatcher.observe_event(
            event_name=self._usd_context.stage_event_name(omni.usd.StageEventType.SELECTION_CHANGED),
            on_event=self._on_selection_changed,
        )
        self._opened_subscription = dispatcher.observe_event(
            event_name=self._usd_context.stage_event_name(omni.usd.StageEventType.OPENED),
            on_event=self._on_stage_opened,
        )
        carb.log_info("[ov.web.viewer.backend] Web viewer messaging backend is ready")

    def on_shutdown(self):
        for task in tuple(getattr(self, "_tasks", ())):
            task.cancel()
        self._tasks.clear()
        self._lift_tasks.clear()
        if getattr(self, "_ws_server", None):
            self._ws_server.close()
            self._ws_server = None
        for websocket in tuple(getattr(self, "_ws_clients", ())):
            self._schedule(websocket.close())
        self._ws_clients.clear()
        if getattr(self, "_selection_subscription", None):
            self._selection_subscription.reset()
            self._selection_subscription = None
        if getattr(self, "_opened_subscription", None):
            self._opened_subscription.reset()
            self._opened_subscription = None
        messaging.unregister_event_type_to_send("viewer:selection-changed")
        messaging.unregister_event_type_to_send("viewer:stage-changed")
        messaging.unregister_event_type_to_send("viewer:interaction")
        for handler in self._handlers:
            if hasattr(handler, "unsubscribe"):
                handler.unsubscribe()
        for event_name in self._legacy_response_events:
            messaging.unregister_event_type_to_send(event_name)
        self._handlers.clear()
        self._legacy_response_events.clear()
        self._usd_context = None

    def _schedule(self, coroutine):
        task = asyncio.ensure_future(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._on_task_done)
        return task

    def _on_task_done(self, task):
        self._tasks.discard(task)
        if task.cancelled():
            return
        error = task.exception()
        if error:
            carb.log_error(f"[ov.web.viewer.backend] Background task failed: {error!r}")

    async def _hide_viewport_hud(self):
        # The viewport id is created after extension startup. Setting both the
        # default and the per-viewport persistent key also overrides old user
        # preferences that enabled the FPS/GPU/memory overlay.
        await omni.kit.app.get_app().next_update_async()
        await omni.kit.app.get_app().next_update_async()
        viewport = omni.kit.viewport.utility.get_active_viewport()
        if viewport:
            carb.settings.get_settings().set(
                f"/persistent/app/viewport/{viewport.id}/hud/visible",
                False,
            )

    def _register_request(self, event_name, handler):
        self._request_handlers[event_name] = handler
        response_name = f"{event_name}:response"
        if hasattr(messaging, "observe_and_dispatch"):
            decorated = messaging.observe_and_dispatch(
                event_name,
                response_name=response_name,
            )(handler)
            self._handlers.append(decorated)
            return

        # Isaac Sim 5.1 ships livestream.messaging 1.1.x. It converts incoming
        # messages to message-bus events but has no request/response decorator.
        event_type = carb.events.type_from_string(event_name)
        bus = omni.kit.app.get_app().get_message_bus_event_stream()

        def on_request(event, request_handler=handler, reply_name=response_name):
            try:
                payload = dict(event.payload.get_dict())
                request_id = str(payload.pop("_request_id", ""))
                result = request_handler(event, **payload)
            except Exception as error:
                carb.log_error(f"[ov.web.viewer.backend] {event_name} failed: {error!r}")
                result = {"success": False, "error": str(error)}
                request_id = locals().get("request_id", "")
            self._send_application_event(reply_name, result, request_id)

        subscription = bus.create_subscription_to_pop_by_type(event_type, on_request)
        self._handlers.append(subscription)
        carb.log_info(
            f"[ov.web.viewer.backend] Legacy messaging adapter registered: "
            f"{event_name} -> {response_name}"
        )

    async def _start_legacy_websocket(self):
        port = carb.settings.get_settings().get_as_int(
            "/exts/ov.web.viewer.backend/websocketPort"
        ) or 8211
        self._ws_server = await websockets.serve(
            self._handle_legacy_websocket,
            "127.0.0.1",
            port,
        )
        carb.log_warn(
            f"[ov.web.viewer.backend] Isaac Sim 5.1 control API listening on ws://127.0.0.1:{port}"
        )

    async def _handle_legacy_websocket(self, websocket):
        self._ws_clients.add(websocket)
        try:
            async for raw_message in websocket:
                request_id = ""
                event_name = "viewer:unknown"
                try:
                    message = json.loads(raw_message)
                    event_name = str(message.get("event_type", event_name))
                    request_id = str(message.get("id", ""))
                    payload = dict(message.get("payload") or {})
                    payload.pop("_request_id", None)
                    handler = self._request_handlers.get(event_name)
                    if not handler:
                        raise ValueError(f"Unknown viewer request: {event_name}")
                    result = handler(None, **payload)
                    response_payload = result
                except Exception as error:
                    carb.log_error(
                        f"[ov.web.viewer.backend] WebSocket request failed: {error!r}"
                    )
                    response_payload = {"success": False, "error": str(error)}

                await websocket.send(
                    json.dumps(
                        {
                            "event_type": f"{event_name}:response",
                            "id": request_id,
                            "payload": response_payload,
                        }
                    )
                )
        finally:
            self._ws_clients.discard(websocket)

    async def _broadcast_legacy_event(self, envelope):
        if not self._ws_clients:
            return
        message = json.dumps(envelope)
        disconnected = []
        for websocket in tuple(self._ws_clients):
            try:
                await websocket.send(message)
            except Exception:
                disconnected.append(websocket)
        for websocket in disconnected:
            self._ws_clients.discard(websocket)

    def _send_application_event(self, event_name, payload, request_id=None):
        if self._legacy_messaging:
            # Kit 107's messaging 1.1.x emits a nested envelope. ov-web-rtc
            # 6.x uses the canonical flat envelope, so publish that wire JSON
            # directly while retaining the 5.1 streamsdk transport event.
            envelope = {"event_type": event_name, "payload": payload}
            if request_id:
                envelope["id"] = request_id
            self._schedule(self._broadcast_legacy_event(envelope))
            return

        queue_event = getattr(omni.kit.app, "queue_event", None)
        if queue_event:
            queue_event(event_name, payload)
            return
        bus = omni.kit.app.get_app().get_message_bus_event_stream()
        bus.push(carb.events.type_from_string(event_name), payload=payload)

    @staticmethod
    def _node(prim):
        return {
            "name": prim.GetName() or "/",
            "path": prim.GetPath().pathString,
            "type": prim.GetTypeName() or "Xform",
            "hasChildren": bool(list(prim.GetChildren())),
        }

    def _current_stage_url(self):
        stage = self._usd_context.get_stage()
        if not stage:
            return ""
        identifier = stage.GetRootLayer().identifier
        return "" if identifier.startswith("anon:") else identifier

    def _selection_path(self):
        paths = self._usd_context.get_selection().get_selected_prim_paths()
        return paths[0] if paths else ""

    def _root_nodes(self):
        stage = self._usd_context.get_stage()
        if not stage:
            return []
        return [self._node(prim) for prim in stage.GetPseudoRoot().GetChildren()]

    @staticmethod
    def _asset_presets():
        root = get_assets_root_path()
        if not root:
            return []
        return [
            {
                "label": "Simple Room",
                "url": f"{root}/Isaac/Environments/Simple_Room/simple_room.usd",
            },
            {
                "label": "Franka Panda",
                "url": f"{root}/Isaac/Robots/FrankaRobotics/FrankaPanda/franka.usd",
            },
            {
                "label": "Carter v2",
                "url": f"{root}/Isaac/Robots/Carter/carter_v2.usd",
            },
        ]

    def _get_stage(self, event, **_kwargs):
        return {
            "url": self._current_stage_url(),
            "nodes": self._root_nodes(),
            "presets": self._asset_presets(),
            "selection": self._selection_path(),
        }

    def _get_children(self, event, path="/", **_kwargs):
        stage = self._usd_context.get_stage()
        if not stage:
            return {"nodes": []}
        prim = stage.GetPseudoRoot() if path == "/" else stage.GetPrimAtPath(path)
        if not prim or not prim.IsValid():
            raise ValueError(f"Prim does not exist: {path}")
        return {"nodes": [self._node(child) for child in prim.GetChildren()]}

    def _open_stage(self, event, url="", **_kwargs):
        url = str(url).strip()
        if not url:
            raise ValueError("A USD URL or local path is required")
        if not self._usd_context.open_stage(url):
            raise ValueError(f"Isaac Sim could not open: {url}")
        self._lifted_paths.clear()
        self._last_stage_url = url
        return {"success": True, "url": url}

    def _reload_stage(self, event, **_kwargs):
        url = self._current_stage_url() or self._last_stage_url
        if not url:
            raise ValueError("The current stage is anonymous and cannot be reloaded")
        if not self._usd_context.open_stage(url):
            raise ValueError(f"Isaac Sim could not reload: {url}")
        self._lifted_paths.clear()
        return {"success": True, "url": url}

    def _select_prim(self, event, path="", **_kwargs):
        stage = self._usd_context.get_stage()
        if not stage or not path or not stage.GetPrimAtPath(path).IsValid():
            raise ValueError(f"Prim does not exist: {path}")
        self._suppressed_selection_path = path
        self._usd_context.get_selection().set_selected_prim_paths([path], True)
        return {"success": True, "path": path}

    def _on_selection_changed(self, _event):
        path = self._selection_path()
        self._send_application_event(
            "viewer:selection-changed",
            {"path": path},
        )
        selected_from_web = path == self._suppressed_selection_path
        self._suppressed_selection_path = None
        if path and not selected_from_web:
            previous = self._lift_tasks.get(path)
            if previous and not previous.done():
                previous.cancel()
            task = self._schedule(self._toggle_lift(path))
            self._lift_tasks[path] = task
            task.add_done_callback(
                lambda completed, selected_path=path: self._lift_tasks.pop(selected_path, None)
                if self._lift_tasks.get(selected_path) is completed
                else None
            )

    def _on_stage_opened(self, _event):
        url = self._current_stage_url()
        self._last_stage_url = url or self._last_stage_url
        self._send_application_event(
            "viewer:stage-changed",
            {"url": url},
        )

    @staticmethod
    def _lift_target_prim(stage, path):
        prim = stage.GetPrimAtPath(path)
        if prim and (prim.GetTypeName() == "Camera" or prim.GetTypeName().endswith("Light")):
            return None
        while prim and prim.IsValid():
            # Picking normally returns a Mesh. Animate its closest Xform parent
            # so the complete object moves as one unit.
            if not prim.IsInstanceProxy() and prim.GetTypeName() == "Xform":
                return prim
            prim = prim.GetParent()
        return None

    @staticmethod
    def _set_session_value(stage, attribute, value):
        previous_target = stage.GetEditTarget()
        try:
            stage.SetEditTarget(stage.GetSessionLayer())
            attribute.Set(value)
        finally:
            stage.SetEditTarget(previous_target)

    async def _toggle_lift(self, selected_path):
        stage = self._usd_context.get_stage()
        if not stage:
            return
        prim = self._lift_target_prim(stage, selected_path)
        if not prim:
            return

        path = prim.GetPath().pathString
        xformable = UsdGeom.Xformable(prim)
        lift_op = next(
            (
                op
                for op in xformable.GetOrderedXformOps()
                if op.GetOpName() == "xformOp:translate:viewerLift"
            ),
            None,
        )
        if lift_op is None:
            previous_target = stage.GetEditTarget()
            try:
                stage.SetEditTarget(stage.GetSessionLayer())
                lift_op = xformable.AddTranslateOp(
                    UsdGeom.XformOp.PrecisionDouble,
                    "viewerLift",
                )
            finally:
                stage.SetEditTarget(previous_target)

        start = lift_op.Get() or Gf.Vec3d(0.0)
        meters_per_unit = UsdGeom.GetStageMetersPerUnit(stage) or 0.01
        distance = 0.25 / meters_per_unit
        axis = 1 if UsdGeom.GetStageUpAxis(stage) == UsdGeom.Tokens.y else 2
        end = Gf.Vec3d(start)
        end[axis] = 0.0 if path in self._lifted_paths else distance

        if path in self._lifted_paths:
            self._lifted_paths.remove(path)
        else:
            self._lifted_paths.add(path)

        for frame in range(1, 31):
            amount = frame / 30.0
            eased = amount * amount * (3.0 - 2.0 * amount)
            value = Gf.Vec3d(
                start[0] + (end[0] - start[0]) * eased,
                start[1] + (end[1] - start[1]) * eased,
                start[2] + (end[2] - start[2]) * eased,
            )
            self._set_session_value(stage, lift_op.GetAttr(), value)
            await omni.kit.app.get_app().next_update_async()
        carb.log_info(
            f"[ov.web.viewer.backend] {'Lowered' if end[axis] == 0.0 else 'Lifted'} {path}"
        )
        self._send_application_event(
            "viewer:interaction",
            {
                "action": "Lowered" if end[axis] == 0.0 else "Lifted",
                "path": path,
            },
        )
