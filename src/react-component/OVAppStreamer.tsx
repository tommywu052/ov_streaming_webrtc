/*
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

import {
    AppStreamer,
    ApplicationMessage,
    DirectConfig,
    GFNConfig,
    NVCFConfig,
    StreamEvent,
    StreamProps,
    StreamType,
    EventAction,
    EventStatus,
} from '@nvidia/ov-web-rtc';
import { DirectPropsDefaults, ViewProps } from './OVAppStreamConfig';

import DeepMerge from 'deepmerge';
import React from 'react';
import StreamVideoElement from './StreamVideoElement';
import { isPlainObject } from 'is-plain-object';

/**
 * The status of the stream.
 */
const enum StreamStatus {
    notReady = 'notReady',
    ready = 'ready',
    failed = 'failed',
}

/**
 * The state of the stream.
 */
interface OVAppStreamState {
    /** Whether or not the stream is ready to render. */
    streamStatus: StreamStatus;
}

export default class OVAppStreamer extends React.Component<ViewProps, OVAppStreamState> {
    /** Whether the stream has been requested. */
    private _requested: boolean = false;
    /** The SDK instance that owns this component's stream and message channel. */
    private readonly _streamer = new AppStreamer();
    /** Whether the stream has been connected. */
    private static connected: boolean = false;
    static defaultProps: ViewProps = DirectPropsDefaults;

    constructor(props: ViewProps) {
        super(props);

        this._requested = false;
        this.state = {
            /* If we have already connected, set state to ready. */
            streamStatus: OVAppStreamer.connected ? StreamStatus.ready : StreamStatus.notReady,
        };
    }

    /**
     * Overrides parent method to initialize the application stream once
     * the component has loaded.
     */
    public componentDidMount(): void {
        if (this.state.streamStatus !== StreamStatus.ready && !this._requested) {
            // The stream is not running and has not been requested yet.
            try {
                this._requested = true;

                const streamSource: StreamType = this.streamSource();
                const streamConfig: DirectConfig | GFNConfig = this.streamConfig();

                ((streamConfig.onUpdate = (message: StreamEvent) => this._onUpdate(message)),
                    (streamConfig.onStart = (message: StreamEvent) => this._onStart(message)));
                streamConfig.onCustomEvent = (message: unknown) => this._onCustomEvent(message);

                if (streamSource === StreamType.DIRECT) {
                    const directStreamConfig = streamConfig as DirectConfig;

                    this.props.onLoggedIn && this.props.onLoggedIn('localUser');

                    directStreamConfig.onStop = (message: StreamEvent) => this._onStop(message);
                }
                else if (streamSource === StreamType.NVCF) {
                    const nvcfStreamConfig = streamConfig as NVCFConfig;

                    this.props.onLoggedIn && this.props.onLoggedIn('localUser');

                    nvcfStreamConfig.onStop = (message: StreamEvent) => this._onStop(message);
                }

                const streamProps: StreamProps = {
                    streamSource: this.streamSource(),
                    streamConfig: streamConfig,
                };

                this._streamer
                    .connect(streamProps)
                    .then((result: StreamEvent) => {
                        console.info(`Success: ${result.info}`);
                    })
                    .catch((error: StreamEvent) => {
                        console.error(error);
                    });
            }
            catch (error) {
                console.error(error);
            }
        }
    }

    /**
     * Returns the streamSource value on the props.
     *
     * @returns {string}
     */
    private streamSource(): StreamType {
        return this.props.stream?.streamSource || '';
    }

    /**
     * Returns the streamConfig value on props.stream. We also deep merge with the
     * default prop values here, so we should ONLY be accessing props.stream.streamConfig
     * through this method.
     *
     * @returns {object}
     */
    private streamConfig(): DirectConfig | GFNConfig {
        const defaultedProps = DeepMerge(DirectPropsDefaults, this.props, {
            isMergeableObject: isPlainObject,
        });

        return defaultedProps.stream?.streamConfig
            ? { ...defaultedProps.stream?.streamConfig }
            : {};
    }

    /**
     * Passes the input message to the streaming application.
     *
     * @param message the message to send to the streaming application.
     */
    public sendMessage(message: ApplicationMessage): Promise<StreamEvent> {
        return this._streamer.sendMessage(message);
    }

    /**
     * Called by the streaming app to pass custom messages to the client.
     *
     * @param message The custom message.
     */
    private _onCustomEvent(message: unknown): void {
        const streamProps = this.streamConfig();
        streamProps?.onCustomEvent && streamProps.onCustomEvent(message);
    }

    /**
     * Called when the stream starts.
     *
     * @param message The StreamEvent message sent when the stream starts.
     */
    private _onStart(message: StreamEvent): void {
        const onStart = this.streamConfig()?.onStart;
        if (message.action === EventAction.START) {
            if (
                message.status === EventStatus.SUCCESS &&
                this.state.streamStatus !== StreamStatus.ready
            ) {
                OVAppStreamer.connected = true;
                // The stream is ready.
                console.debug('Stream Ready');
                this.setState({ streamStatus: StreamStatus.ready });
                onStart && onStart(message);

                if (
                    this.props.maxConnectionTime !== undefined &&
                    this.props.maxConnectionTime > 0
                ) {
                    // The max connection time is set, so set a timer to terminate the stream.
                    setTimeout(() => {
                        void this._streamer.terminate();
                        (this.streamConfig() as DirectConfig)?.onStop?.({
                            action: EventAction.TERMINATE,
                            status: EventStatus.SUCCESS,
                            info: 'max-timeout',
                        });
                    }, this.props.maxConnectionTime * 1000);
                }
            }
            else if (message.status === EventStatus.WARNING) {
                console.warn(message.info);
            }
            else if (message.status === EventStatus.ERROR) {
                console.error(message.info);
                message.info;
                this.setState({ streamStatus: StreamStatus.failed }, () => {
                    onStart && onStart(message);
                    // AppStreamer.terminate();
                });
            }
        }
    }

    /**
     * Called when the stream stops.
     *
     * @param message The StreamEvent message sent when the stream stops.
     */
    private _onStop(message: StreamEvent): void {
        OVAppStreamer.connected = false;
        const directStreamConfig = this.streamConfig() as DirectConfig;
        directStreamConfig?.onStop && directStreamConfig.onStop(message);

        if (message.action === EventAction.TERMINATE && message.status === EventStatus.ERROR) {
            this.setState({ streamStatus: StreamStatus.failed });
        }
    }

    /**
     * Called when the stream status updates.
     *
     * @param message The StreamEvent message sent when the stream status updates.
     */
    private _onUpdate(message: StreamEvent): void {
        try {
            if (
                message.action === EventAction.AUTH_USER &&
                message.status === EventStatus.SUCCESS
            ) {
                if (typeof message.info === 'string') {
                    this.props.onLoggedIn && this.props.onLoggedIn(message.info);
                }
                else {
                    throw new Error('Not implemented.');
                }
            }

            const onUpdate = this.streamConfig()?.onUpdate;

            onUpdate && onUpdate(message);
        }
        catch (error) {
            console.error(message);
        }
    }

    public render(): React.ReactNode {
        const showPlaceholder =
            !!this.props.placeholder && this.state.streamStatus !== StreamStatus.ready;
        const visibility =
            this.state.streamStatus === StreamStatus.ready || showPlaceholder
                ? 'visible'
                : 'hidden';
        const streamConfig = this.streamConfig();
        const canvasExtentStyle: React.CSSProperties = {
            visibility: visibility,
        };
        const videoElementStyle: React.CSSProperties = {
            outline: 'none',
            position: 'relative',
            top: 0,
            left: 0,
            width: '100%',
            visibility: visibility,
        };
        const needsVideoElement =
            this.streamSource() === StreamType.DIRECT || this.streamSource() === StreamType.NVCF;
        const videoElementId = needsVideoElement
            ? (streamConfig as DirectConfig).videoElementId
            : null;

        return (
            <div
                key={'stream-canvas'}
                id={'main-div'}
                className={'canvas-extent'}
                style={this.props.style}
            >
                <div
                    id={'aspect-ratio-div'}
                    className={'canvas-extent'}
                    tabIndex={0}
                    onFocus={this.props.onFocus}
                    onBlur={this.props.onBlur}
                    style={canvasExtentStyle}
                >
                    {showPlaceholder && this.props.placeholder}
                    {this.streamSource() === StreamType.GFN && <div id="view" />}
                    {needsVideoElement && videoElementId && (
                        <>
                            <StreamVideoElement
                                // poster = {'coffe_machine_0.png'}
                                key={'ov-react-app-streamer-video-canvas'}
                                videoElementId={videoElementId}
                                videoSwapParentId={this.props.videoSwapParentId}
                                style={videoElementStyle}
                            />
                            <audio id={(streamConfig as DirectConfig).audioElementId} muted></audio>
                        </>
                    )}
                </div>
            </div>
        );
    }
}
