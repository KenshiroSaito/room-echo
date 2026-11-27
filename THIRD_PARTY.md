# Third-party data

The site bundles no third-party files: no images, audio, models or fonts. The only outside material is a set of published absorption coefficients. They are written into `src/sim/materials.ts` as numbers, with the source of every value. No document is copied.

## Absorption coefficients

Each material gets a single absorption coefficient α. It is the mean of the published octave-band values at 250, 500, 1000 and 2000 Hz. These are the four bands of the noise reduction coefficient (NRC), without the NRC's rounding to 0.05. `src/sim/materials.ts` keeps the band values, so each α can be checked against its source.

### `vorlaender-2008`: walls, and the tile, wood and carpet floors

- **Origin:** the annex of M. Vorländer, _Auralization: Fundamentals of Acoustics, Modelling, Simulation, Algorithms and Acoustic Virtual Reality_, Springer, 1st edition, 2008.
- **Taken from:** the materials database of pyroomacoustics, `pyroomacoustics/data/materials.json` (https://github.com/LCAV/pyroomacoustics; commit `eb399899e3b3`, read 2026-11-26). The project's documentation states that the values come from the annex of that book.
- **License:** pyroomacoustics is released under the MIT License, © 2014–2017 EPFL-LCAV. Only the numbers are used, and the file itself is not bundled.

| Room Echo material | pyroomacoustics key     | Specimen                                                                     | 125–4000 Hz                   | α      |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------- | ----------------------------- | ------ |
| Concrete / tile    | `unpainted_concrete`    | Smooth unpainted concrete                                                    | 0.01 0.01 0.02 0.02 0.02 0.05 | 0.0175 |
| Glass              | `glass_window`          | Glass window, 0.68 kg/m²                                                     | 0.10 0.05 0.04 0.03 0.03 0.03 | 0.0375 |
| Plasterboard       | `plasterboard`          | 2 × 13 mm plasterboard on steel frame, 50 mm mineral wool in cavity, painted | 0.15 0.10 0.06 0.04 0.04 0.05 | 0.06   |
| Wood panel         | `wooden_lining`         | Wooden lining, 12 mm, fixed on frame                                         | 0.27 0.23 0.22 0.15 0.10 0.07 | 0.175  |
| Heavy curtain      | `curtains_cotton_0.5`   | Cotton curtains, 0.5 kg/m², draped to 3/4 area, about 130 mm from the wall   | 0.30 0.45 0.65 0.56 0.59 0.71 | 0.5625 |
| Acoustic foam      | `ceiling_melamine_foam` | Wedge-shaped melamine foam tile                                              | 0.12 0.33 0.83 0.97 0.98 0.95 | 0.7775 |
| Floor: Tile        | `ceramic_tiles`         | Ceramic tiles with a smooth surface                                          | 0.01 0.01 0.01 0.02 0.02 0.02 | 0.015  |
| Floor: Wood        | `audience_floor`        | Wood floor, 2 layers, 33 mm on sleepers over concrete                        | 0.09 0.06 0.05 0.05 0.05 0.04 | 0.0525 |
| Floor: Carpet      | `carpet_tufted_9m`      | 9 mm tufted pile carpet on felt underlay                                     | 0.08 0.08 0.30 0.60 0.75 0.80 | 0.4325 |

### `kumamoto-2014`: the tatami floor

- **Origin:** Kumamoto Prefecture, Department of Agriculture, Forestry and Fisheries, _Agricultural research results information_ No. 645 (May 2014): 「和室における畳の機能性の評価」 ("Evaluation of the functions of tatami in Japanese-style rooms"). Published by the Igusa Research Institute of the Kumamoto Prefectural Agricultural Research Center. Figure 3 shows the absorption coefficient of tatami with a rice-straw core, from a joint test with Kumamoto University.
- **URL:** https://www.pref.kumamoto.jp/uploaded/attachment/4955.pdf (read 2026-11-26).
- **License:** none stated. Only six values read off the chart are used, as facts with their source; the document is not copied or bundled.
- **Precision:** the values were read off the chart, to about ±0.01. The document does not say how they were measured, whether with the reverberation-room method or at normal incidence.

| Room Echo material | Specimen                            | 125–4000 Hz (read off figure 3) | α     |
| ------------------ | ----------------------------------- | ------------------------------- | ----- |
| Floor: Tatami      | Tatami with a 50 mm rice-straw core | 0.30 0.345 0.295 0.43 0.51 0.49 | 0.395 |

The same figure shows a wooden board floor ("板張り床", from a Kumamoto Prefectural University thesis). It reads about 0.15, 0.12, 0.10, 0.08, 0.08 and 0.08, which gives α ≈ 0.095. Room Echo's Wood floor, from the first source, is 0.0525. The two agree within what varies between real floors.
