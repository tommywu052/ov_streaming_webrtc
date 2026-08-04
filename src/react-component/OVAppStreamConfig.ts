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

import { StreamProps, StreamEvent, StreamType } from '@nvidia/ov-web-rtc';

/**
 * StreamProps currenlty requires all props, so we use Partial and define commobn
 * defaults.
 */
export interface ViewProps {
    /** The id of the element to swap the video element to when unmounting. */
    videoSwapParentId?: string;
    /** Optional element to display while loading/connecting the stream. @defaultValue null */
    placeholder?: React.ReactElement;
    /** Optional additional styling for the stream rendering canvas. */
    style?: React.CSSProperties;
    /** Focus callback for the stream render canvas. */
    onFocus?: () => void;
    /** Blur callback for the stream render canvas. */
    onBlur?: () => void;
    /** Called when a user is authenticated. */
    onLoggedIn?: (userId: string) => void;
    /** Pass-through params for the streaming library setup. */
    stream: StreamProps;
    /** The maximum connection time for the stream, in seconds. No maximum if 0. When this is set,
     * the stream will terminate after the specified time and the onStop callback will
     * be called with the StreamEvent {
     *     action: EventAction.TERMINATE,
     *     status: EventStatus.SUCCESS,
     *     info: 'max-timeout'
     * }. @defaultValue 0 */
    maxConnectionTime?: number;
}

export const DirectPropsDefaults: ViewProps = {
    videoSwapParentId: '',
    stream: {
        streamSource: StreamType.DIRECT,
        streamConfig: {
            videoElementId: 'remote-video',
            audioElementId: 'remote-audio',
            width: 1920,
            height: 1080,
            fps: 60,
            authenticate: false,
            maxReconnects: 5,
            onUpdate: (message: StreamEvent) => {
                console.debug(message);
            },
            onStart: (message: StreamEvent) => {
                console.debug(message);
            },
            onStop: (message: StreamEvent) => {
                console.debug(message);
            },
            onTerminate: (message: StreamEvent) => {
                console.debug(message);
            },
            onStreamStats: (message: StreamEvent) => {
                console.debug(message);
            },
            onCustomEvent: (message: unknown) => {
                console.debug(message);
            },
        },
    },
};

export const DefaultViewProps: ViewProps = {
    stream: DirectPropsDefaults.stream,
    maxConnectionTime: 0,
};
