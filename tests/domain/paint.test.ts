import { describe, expect, it } from 'vitest';
import { PAINT_PRESETS } from '../../src/domain/paint';

describe('PAINT_PRESETS', () => {
  it('has about a dozen pigments with unique ids', () => {
    expect(PAINT_PRESETS.length).toBeGreaterThanOrEqual(12);
    const ids = PAINT_PRESETS.map((paint) => paint.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ranks Titanium White heaviest and quinacridones among the lightest', () => {
    const white = PAINT_PRESETS.find((paint) => paint.id === 'titanium-white');
    const quinGold = PAINT_PRESETS.find((paint) => paint.id === 'quinacridone-gold');
    const quinMagenta = PAINT_PRESETS.find((paint) => paint.id === 'quinacridone-magenta');
    const phthalo = PAINT_PRESETS.find((paint) => paint.id === 'phthalo-blue');
    const cadmium = PAINT_PRESETS.find((paint) => paint.id === 'cadmium-red');
    expect(white && quinGold && quinMagenta && phthalo && cadmium).toBeTruthy();
    if (!white || !quinGold || !quinMagenta || !phthalo || !cadmium) {
      return;
    }
    expect(white.density).toBeGreaterThan(cadmium.density);
    expect(cadmium.density).toBeGreaterThan(phthalo.density);
    expect(phthalo.density).toBeGreaterThan(quinMagenta.density);
    expect(quinMagenta.density).toBeGreaterThanOrEqual(quinGold.density);
  });
});
