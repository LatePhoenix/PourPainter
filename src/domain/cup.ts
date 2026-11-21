export type CupType = 'single' | 'split' | 'funnel' | 'colander' | 'squeeze';

/** One paint stratum in the cup. Layers are ordered bottom → top. */
export type CupLayer = {
  paintId: string;
  /** Volume of this layer, ml. */
  volumeMl: number;
};

export type Cup = {
  type: CupType;
  layers: readonly CupLayer[];
};

export function totalCupVolumeMl(cup: Cup): number {
  return cup.layers.reduce((sum, layer) => sum + layer.volumeMl, 0);
}
