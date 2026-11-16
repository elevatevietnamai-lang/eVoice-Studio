import { BaseNode } from "./base-node";

export type ColorNodeParams = {
	color: string;
	/**
	 * eVoice Studio: how opaque the colour is at a timeline second (the black of
	 * a fade through black); always opaque without it.
	 */
	opacityAt?: (seconds: number) => number;
};

export class ColorNode extends BaseNode<ColorNodeParams, { opacity: number }> {}
