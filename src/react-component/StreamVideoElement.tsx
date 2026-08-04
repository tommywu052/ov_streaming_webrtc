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
import React, { CSSProperties } from 'react';

/**
 * Props definition for class StreamVideoElement
 */
export interface StreamVideoElementProps {
    /** The poster placeholder image for the video stream. */
    poster?: string;
    /** The style of the video element. */
    style: CSSProperties;
    /** The id of the video element */
    videoElementId: string;
    /** The id of the element to swap the video element to if the component tree unmounts and remounts. */
    videoSwapParentId?: string;
}

/**
 * StreamVideoElement encapsulates management of the video element that we stream into. If
 * the component tree re-mounts without explicitly disconnecting from the stream, we do not
 * want to have to re-connect to the stream since the stream socket will still be connected.
 * This component handles that case by swapping the video element's parent to one passed in
 * by the caller that is higher up the tree and will not be re-mounted.
 */
export default class StreamVideoElement extends React.Component<StreamVideoElementProps> {
    private divWrapper: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();

    constructor(props: StreamVideoElementProps) {
        super(props);
    }

    /**
     * The parent method is overriden to create and/or attach the
     * video element.
     */
    public componentDidMount(): void {
        const divWrapper = this.divWrapper.current;

        if (divWrapper) {
            let videoCanvas = document.getElementById(
                this.props.videoElementId
            ) as HTMLVideoElement | null;

            if (!videoCanvas) {
                //
                // The video element has not yet been created.
                //

                videoCanvas = document.createElement('video');

                videoCanvas.autoplay = true;
                videoCanvas.id = this.props.videoElementId;
                videoCanvas.muted = true;
                videoCanvas.playsInline = true;
                videoCanvas.poster = this.props.poster || '';
                videoCanvas.tabIndex = -1;

                if (this.props.style.position) {
                    videoCanvas.style.position = this.props.style.position;
                }
            }

            if (videoCanvas && videoCanvas.parentElement?.id !== divWrapper.id) {
                //
                // Either the element has just been created or is currently attached
                // to a swap parent. Append it here and make sure it is visible.
                //
                videoCanvas.style.visibility = 'visible';

                if (this.props.style.position) {
                    videoCanvas.style.position = this.props.style.position;
                }

                divWrapper.appendChild(videoCanvas);
            }
        }
    }

    /**
     * The parent method has been overriden to move the video element to
     * the swap parent before unmount so that the stream does not have to
     * be re-appended on re-mount.
     */
    public componentWillUnmount(): void {
        const videoCanvas = document.getElementById(this.props.videoElementId);

        if (videoCanvas && this.props.videoSwapParentId) {
            //
            // Remove the element from the layout flow and hide it,
            // them attach it to the swap parent.
            //

            const topParent = document.getElementById(this.props.videoSwapParentId);

            videoCanvas.style.visibility = 'hidden';
            videoCanvas.style.position = 'fixed';

            topParent && topParent.appendChild(videoCanvas);
        }
    }

    public render(): React.ReactNode {
        return <div id="my-super-id" ref={this.divWrapper} style={this.props.style} />;
    }
}
