/*
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES.
 * SPDX-License-Identifier: MIT
 */

import './index.css';
import {
    ApplicationMessage,
    DirectConfig,
    EventAction,
    EventStatus,
    StreamEvent,
    StreamType,
} from '@nvidia/ov-web-rtc';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import OVAppStreamer from './react-component/OVAppStreamer';
import type { ViewProps } from './react-component/OVAppStreamConfig';

type ConnectionState = 'connecting' | 'ready' | 'error' | 'stopped';

type ViewerMessage = {
    event_type: string;
    id?: string;
    payload?: Record<string, unknown>;
};

type StageNodeData = {
    name: string;
    path: string;
    type: string;
    hasChildren: boolean;
};

type AssetPreset = {
    label: string;
    url: string;
};

type PendingRequest = {
    resolve: (message: ViewerMessage) => void;
    reject: (reason: Error) => void;
    timer: number;
};

function Icon({ name }: { name: 'cube' | 'chevron' | 'refresh' | 'folder' | 'status' }) {
    const paths = {
        cube: (
            <>
                <path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z" />
                <path d="m4.8 7.4 7.2 4 7.2-4M12 11.4V21" />
            </>
        ),
        chevron: <path d="m9 6 6 6-6 6" />,
        refresh: (
            <>
                <path d="M20 7v5h-5" />
                <path d="M19 12a7 7 0 1 0-2 5" />
            </>
        ),
        folder: <path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z" />,
        status: <circle cx="12" cy="12" r="7" />,
    };
    return (
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            {paths[name]}
        </svg>
    );
}

function StageNode({
    node,
    selectedPath,
    onSelect,
    loadChildren,
}: {
    node: StageNodeData;
    selectedPath: string;
    onSelect: (path: string) => void;
    loadChildren: (path: string) => Promise<StageNodeData[]>;
}) {
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [children, setChildren] = useState<StageNodeData[] | null>(null);
    const rowRef = useRef<HTMLDivElement>(null);

    const revealSelection = selectedPath === node.path || selectedPath.startsWith(`${node.path}/`);

    useEffect(() => {
        if (!revealSelection || !node.hasChildren || expanded || loadFailed) return;

        let active = true;
        const reveal = async () => {
            setLoading(true);
            try {
                const loaded = children ?? (await loadChildren(node.path));
                if (active) {
                    setChildren(loaded);
                    setExpanded(true);
                }
            }
            catch {
                if (active) setLoadFailed(true);
            }
            finally {
                if (active) setLoading(false);
            }
        };
        void reveal();
        return () => {
            active = false;
        };
    }, [
        children,
        expanded,
        loadChildren,
        loadFailed,
        node.hasChildren,
        node.path,
        revealSelection,
    ]);

    useEffect(() => {
        if (selectedPath !== node.path) return;
        window.requestAnimationFrame(() => {
            rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }, [node.path, selectedPath]);

    const toggle = async () => {
        if (!node.hasChildren) return;
        if (!expanded && children === null) {
            setLoading(true);
            try {
                setChildren(await loadChildren(node.path));
            }
            finally {
                setLoading(false);
            }
        }
        setExpanded(value => !value);
    };

    return (
        <li className="stage-node">
            <div
                ref={rowRef}
                className={`stage-row ${selectedPath === node.path ? 'selected focused' : ''}`}
                data-stage-path={node.path}
            >
                <button
                    className={`tree-toggle ${expanded ? 'expanded' : ''}`}
                    onClick={() => void toggle()}
                    disabled={!node.hasChildren || loading}
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                >
                    {node.hasChildren && <Icon name="chevron" />}
                </button>
                <button
                    className="stage-label"
                    onClick={() => onSelect(node.path)}
                    title={node.path}
                >
                    <Icon name="cube" />
                    <span>{node.name}</span>
                    <small>{node.type || 'Xform'}</small>
                </button>
            </div>
            {expanded && children && (
                <ul>
                    {children.map(child => (
                        <StageNode
                            key={child.path}
                            node={child}
                            selectedPath={selectedPath}
                            onSelect={onSelect}
                            loadChildren={loadChildren}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

function ViewerApp() {
    const targetVersion = import.meta.env.VITE_ISAAC_VERSION;
    const streamerRef = useRef<OVAppStreamer>(null);
    const viewerSocket = useRef<WebSocket | null>(null);
    const pending = useRef(new Map<string, PendingRequest>());
    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [errorMessage, setErrorMessage] = useState('');
    const [statusText, setStatusText] = useState('Connecting to Isaac Sim');
    const [stageUrl, setStageUrl] = useState('');
    const [assetUrl, setAssetUrl] = useState('');
    const [presets, setPresets] = useState<AssetPreset[]>([]);
    const [roots, setRoots] = useState<StageNodeData[]>([]);
    const [selectedPath, setSelectedPath] = useState('');
    const [busy, setBusy] = useState(false);

    const handleCustomEvent = useCallback((raw: unknown) => {
        let message = raw as ViewerMessage;
        if (!message?.event_type) return;

        // Livestream messaging 1.1.x (Isaac Sim 5.1) places correlation
        // metadata inside payload. Messaging 1.3.x returns it at the top level.
        const legacyId = message.payload?.id;
        const legacyPayload = message.payload?.payload;
        const legacyPayloadJson = message.payload?.payload_json;
        if (!message.id && typeof legacyId === 'string' && typeof legacyPayloadJson === 'string') {
            message = {
                event_type: message.event_type,
                id: legacyId,
                payload: JSON.parse(legacyPayloadJson) as Record<string, unknown>,
            };
        }
        else if (!message.id && typeof legacyId === 'string' && legacyPayload) {
            message = {
                event_type: message.event_type,
                id: legacyId,
                payload: legacyPayload as Record<string, unknown>,
            };
        }

        if (message.id) {
            const request = pending.current.get(message.id);
            if (request) {
                window.clearTimeout(request.timer);
                pending.current.delete(message.id);
                request.resolve(message);
                return;
            }
        }

        if (message.event_type === 'viewer:selection-changed') {
            setSelectedPath(String(message.payload?.path ?? ''));
        }
        else if (message.event_type === 'viewer:stage-changed') {
            setStageUrl(String(message.payload?.url ?? ''));
        }
        else if (message.event_type === 'viewer:interaction') {
            const action = String(message.payload?.action ?? 'Updated');
            const path = String(message.payload?.path ?? 'object');
            setStatusText(`${action} ${path}`);
        }
    }, []);

    useEffect(() => {
        if (targetVersion !== '5.1') return;
        const socket = new WebSocket('ws://127.0.0.1:8211');
        viewerSocket.current = socket;
        socket.onmessage = event => {
            try {
                handleCustomEvent(JSON.parse(String(event.data)));
            }
            catch (error) {
                console.error('Invalid Isaac Sim 5.1 control message', error);
            }
        };
        return () => {
            viewerSocket.current = null;
            socket.close();
        };
    }, [handleCustomEvent, targetVersion]);

    const sendRequest = useCallback(
        async (
            eventType: string,
            payload: Record<string, unknown> = {},
            timeoutMs = 15000
        ): Promise<ViewerMessage> => {
            const id = crypto.randomUUID();
            const message: ApplicationMessage = {
                event_type: eventType,
                id,
                payload: { ...payload, _request_id: id },
            };
            const response = new Promise<ViewerMessage>((resolve, reject) => {
                const timer = window.setTimeout(() => {
                    pending.current.delete(id);
                    reject(new Error(`Timed out waiting for ${eventType}`));
                }, timeoutMs);
                pending.current.set(id, { resolve, reject, timer });
            });

            try {
                if (targetVersion === '5.1') {
                    const socket = viewerSocket.current;
                    if (!socket) throw new Error('Isaac Sim 5.1 control API is not initialized');
                    if (socket.readyState !== WebSocket.OPEN) {
                        await new Promise<void>((resolve, reject) => {
                            const timer = window.setTimeout(
                                () => reject(new Error('Isaac Sim 5.1 control API timed out')),
                                5000
                            );
                            socket.addEventListener(
                                'open',
                                () => {
                                    window.clearTimeout(timer);
                                    resolve();
                                },
                                { once: true }
                            );
                            socket.addEventListener(
                                'error',
                                () => {
                                    window.clearTimeout(timer);
                                    reject(new Error('Isaac Sim 5.1 control API is unavailable'));
                                },
                                { once: true }
                            );
                        });
                    }
                    socket.send(JSON.stringify(message));
                }
                else {
                    await streamerRef.current?.sendMessage(message);
                }
            }
            catch (error) {
                const request = pending.current.get(id);
                if (request) window.clearTimeout(request.timer);
                pending.current.delete(id);
                throw error;
            }
            return response;
        },
        [targetVersion]
    );

    const refreshStage = useCallback(async () => {
        const response = await sendRequest('viewer:get-stage');
        const payload = response.payload ?? {};
        setStageUrl(String(payload.url ?? ''));
        setAssetUrl(String(payload.url ?? ''));
        setRoots((payload.nodes as StageNodeData[]) ?? []);
        setPresets((payload.presets as AssetPreset[]) ?? []);
        setSelectedPath(String(payload.selection ?? ''));
        setStatusText('Stage synchronized');
    }, [sendRequest]);

    const loadChildren = useCallback(
        async (path: string) => {
            const response = await sendRequest('viewer:get-children', { path });
            return (response.payload?.nodes as StageNodeData[]) ?? [];
        },
        [sendRequest]
    );

    const openStage = async () => {
        if (!assetUrl.trim()) return;
        setBusy(true);
        setStatusText('Opening USD stage');
        try {
            const response = await sendRequest(
                'viewer:open-stage',
                { url: assetUrl.trim() },
                60000
            );
            if (response.payload?.success === false) {
                throw new Error(String(response.payload?.error ?? 'Unable to open stage'));
            }
            await refreshStage();
        }
        catch (error) {
            setStatusText(error instanceof Error ? error.message : 'Unable to open stage');
        }
        finally {
            setBusy(false);
        }
    };

    const reloadStage = async () => {
        setBusy(true);
        setStatusText('Reloading stage');
        try {
            await sendRequest('viewer:reload-stage', {}, 60000);
            await refreshStage();
        }
        catch (error) {
            setStatusText(error instanceof Error ? error.message : 'Unable to reload stage');
        }
        finally {
            setBusy(false);
        }
    };

    const selectPrim = useCallback(
        async (path: string) => {
            setSelectedPath(path);
            try {
                await sendRequest('viewer:select-prim', { path });
            }
            catch (error) {
                setStatusText(error instanceof Error ? error.message : 'Selection failed');
            }
        },
        [sendRequest]
    );

    const streamConfig = useMemo<DirectConfig>(
        () => ({
            videoElementId: 'remote-video',
            signalingServer:
                import.meta.env.VITE_SIGNALING_SERVER || window.location.hostname || '127.0.0.1',
            width: 1280,
            height: 720,
            fps: 30,
            onStart: (message: StreamEvent) => {
                if (message.action !== EventAction.START) return;
                if (message.status === EventStatus.SUCCESS) {
                    setConnection('ready');
                    setStatusText('Connected');
                    window.setTimeout(() => {
                        void refreshStage().catch(error => {
                            setStatusText(
                                error instanceof Error ? error.message : 'Backend is not responding'
                            );
                        });
                    }, 300);
                }
                else if (message.status === EventStatus.ERROR) {
                    setConnection('error');
                    setErrorMessage(String(message.info || 'Unable to connect'));
                }
            },
            onCustomEvent: handleCustomEvent,
            onStop: () => {
                setConnection('stopped');
                setStatusText('Stream stopped');
            },
        }),
        [handleCustomEvent, refreshStage]
    );

    const viewProps: ViewProps = useMemo(
        () => ({
            stream: { streamSource: StreamType.DIRECT, streamConfig },
        }),
        [streamConfig]
    );

    return (
        <main className="viewer-shell">
            <header className="app-header">
                <div className="brand-mark">N</div>
                <div>
                    <strong>Omniverse Web Viewer</strong>
                    <span>Isaac Sim{targetVersion ? ` ${targetVersion}` : ''} · WebRTC</span>
                </div>
                <div className={`connection-pill ${connection}`}>
                    <Icon name="status" />
                    {connection === 'ready' ? 'Live' : connection}
                </div>
            </header>

            <section className="workspace">
                <div className="viewport-panel">
                    <OVAppStreamer ref={streamerRef} {...viewProps} />
                    {connection !== 'ready' && (
                        <div className={`stream-overlay ${connection}`}>
                            <div className="spinner" />
                            <h2>
                                {connection === 'error'
                                    ? 'Connection failed'
                                    : 'Waiting for stream'}
                            </h2>
                            <p>
                                {connection === 'error'
                                    ? errorMessage
                                    : 'Starting Isaac Sim WebRTC session…'}
                            </p>
                        </div>
                    )}
                    <div className="viewport-hint">
                        ALT + drag orbit · RMB + WASD fly · Scroll changes speed
                    </div>
                </div>

                <aside className="inspector-panel">
                    <section className="panel-section asset-section">
                        <div className="section-heading">
                            <div>
                                <span className="eyebrow">OPENUSD</span>
                                <h2>Asset</h2>
                            </div>
                            <button
                                className="icon-button"
                                onClick={() => void reloadStage()}
                                disabled={busy || !stageUrl}
                                title="Reload stage"
                            >
                                <Icon name="refresh" />
                            </button>
                        </div>

                        <label htmlFor="asset-preset">Preset</label>
                        <select
                            id="asset-preset"
                            value={presets.some(item => item.url === assetUrl) ? assetUrl : ''}
                            onChange={event => setAssetUrl(event.target.value)}
                            disabled={busy || connection !== 'ready'}
                        >
                            <option value="">Custom USD path</option>
                            {presets.map(item => (
                                <option key={item.url} value={item.url}>
                                    {item.label}
                                </option>
                            ))}
                        </select>

                        <label htmlFor="asset-url">USD URL or local path</label>
                        <div className="url-input">
                            <Icon name="folder" />
                            <input
                                id="asset-url"
                                value={assetUrl}
                                onChange={event => setAssetUrl(event.target.value)}
                                placeholder="omniverse://, https://, or C:\\…\\scene.usd"
                            />
                        </div>
                        <button
                            className="primary-button"
                            onClick={() => void openStage()}
                            disabled={busy || connection !== 'ready' || !assetUrl.trim()}
                        >
                            {busy ? 'Working…' : 'Open stage'}
                        </button>
                    </section>

                    <section className="panel-section stage-section">
                        <div className="section-heading compact">
                            <div>
                                <span className="eyebrow">SCENE GRAPH</span>
                                <h2>USD Stage</h2>
                            </div>
                            <button
                                className="icon-button"
                                onClick={() => void refreshStage()}
                                disabled={busy || connection !== 'ready'}
                                title="Refresh tree"
                            >
                                <Icon name="refresh" />
                            </button>
                        </div>
                        <div className="stage-url" title={stageUrl}>
                            {stageUrl || 'Untitled stage'}
                        </div>
                        <div className="tree-scroll" tabIndex={0}>
                            {roots.length > 0 ? (
                                <ul className="stage-tree">
                                    {roots.map(node => (
                                        <StageNode
                                            key={node.path}
                                            node={node}
                                            selectedPath={selectedPath}
                                            onSelect={selectPrim}
                                            loadChildren={loadChildren}
                                        />
                                    ))}
                                </ul>
                            ) : (
                                <div className="empty-state">No prims in the current stage</div>
                            )}
                        </div>
                    </section>

                    <footer className="panel-footer">
                        <span className="status-dot" />
                        <span>{statusText}</span>
                    </footer>
                </aside>
            </section>
        </main>
    );
}

ReactDOM.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
        <ViewerApp />
    </React.StrictMode>
);
