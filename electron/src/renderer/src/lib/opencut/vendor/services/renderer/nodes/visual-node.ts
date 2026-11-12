import { BaseNode } from "./base-node";
import type { Effect, EffectPass } from "../../../effects/types";
import type { Mask } from "../../../masks/types";
import type { BlendMode, Transform } from "../../../rendering";
import type { RetimeConfig, VisualElement } from "../../../timeline";
import type { FrameAdjustFn } from "../../../../frame-adjust";

export interface VisualNodeParams {
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	transform: Transform;
	animations?: VisualElement["animations"];
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
	/** eVoice Studio: a canvas filter for the colour look (see lib/opencut/color-filter). */
	colorFilter?: string;
	/** eVoice Studio: per-frame changes from the editor, such as a transition (see lib/opencut/frame-adjust). */
	frameAdjust?: FrameAdjustFn;
	/**
	 * eVoice Studio: which decoder plays the clip's file. Two clips of one file
	 * on screen at once (a transition between the halves of a split clip) each
	 * need their own, or they read each other's frames.
	 */
	cacheKey?: string;
}

export interface ResolvedVisualNodeState {
	localTime: number;
	transform: Transform;
	opacity: number;
	effectPasses: EffectPass[][];
	/** eVoice Studio: the canvas band a wipe leaves visible (shares of the width). */
	clip?: { from: number; to: number };
}

export interface ResolvedVisualSourceNodeState extends ResolvedVisualNodeState {
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	/** eVoice Studio: changes when a reused source (a pooled video canvas) holds a new frame. */
	sourceRevision?: number;
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
	Resolved extends ResolvedVisualNodeState = ResolvedVisualNodeState,
> extends BaseNode<Params, Resolved> {}
