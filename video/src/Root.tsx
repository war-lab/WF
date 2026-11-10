import React from 'react';
import { Composition } from 'remotion';
import { Main } from './Main';
import { buildBeats, FPS, loadPlayVoice } from './timeline';
import { Guide, buildGuide, loadVoice } from './Guide';


export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="WordFarm" component={Main} durationInFrames={buildBeats().total} fps={FPS} width={1920} height={1080}
      defaultProps={{ voice: null }}
      calculateMetadata={async () => {
        const voice = await loadPlayVoice();
        return { durationInFrames: buildBeats(voice).total, props: { voice } };
      }}
    />
    <Composition
      id="WordFarmGuide" component={Guide} durationInFrames={buildGuide().total} fps={FPS} width={1920} height={1080}
      defaultProps={{ voice: null }}
      calculateMetadata={async () => {
        const voice = await loadVoice();
        return { durationInFrames: buildGuide(voice).total, props: { voice } };
      }}
    />
  </>
);
