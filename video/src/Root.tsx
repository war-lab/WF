import React from 'react';
import { Composition } from 'remotion';
import { Main } from './Main';
import { buildBeats, FPS } from './timeline';
import { Guide, buildGuide } from './Guide';

const { total } = buildBeats();
const guideTotal = buildGuide().total;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="WordFarm" component={Main} durationInFrames={total} fps={FPS} width={1920} height={1080} />
    <Composition id="WordFarmGuide" component={Guide} durationInFrames={guideTotal} fps={FPS} width={1920} height={1080} />
  </>
);
