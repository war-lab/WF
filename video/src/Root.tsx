import React from 'react';
import { Composition } from 'remotion';
import { Main } from './Main';
import { buildBeats, FPS } from './timeline';

const { total } = buildBeats();

export const RemotionRoot: React.FC = () => (
  <Composition id="WordFarm" component={Main} durationInFrames={total} fps={FPS} width={1920} height={1080} />
);
