import { type ReactNode } from 'react';
import { Group } from '@mantine/core';

import { AudioCapture } from '../Capture/AudioCapture';
import { VideoCapture } from '../Capture/VideoCapture';
import {
  AUDIO_TYPE,
  type AudioParameters,
  type PatternParameters,
  type PatternType,
  VIDEO_TYPE,
  videoCaptureOf,
  type VideoParameters
} from '../lib/api';

import { type FormValues, toProps } from './PatternForm';

// Moved out of the form's inputs into the capture panel, next to the feed they shape.
const AUDIO_PANEL_FIELDS = ['input'];
const VIDEO_PANEL_FIELDS = [
  'input',
  'sampling',
  'offset',
  'direction',
  'ndiSource',
  'centerX',
  'centerY',
  'radius',
  'ringWidth',
  'rotation',
  'stripY',
  'stripHeight'
];

export interface CaptureFormProps {
  hiddenFields?: readonly string[];
  panel?: (
    values: FormValues,
    setField: (key: string, value: number | string) => void,
    field: (key: string) => ReactNode
  ) => ReactNode;
}

// The capture panel for the patterns a browser capture feeds, keyed by `feed`, which the
// dialog's preview has to be named after. `saved` is the pattern as stored, or null
// while it is still being added.
export function captureFormProps(
  type: PatternType,
  feed: string,
  saved: PatternParameters | null
): CaptureFormProps {
  if (type === AUDIO_TYPE) {
    return {
      hiddenFields: AUDIO_PANEL_FIELDS,
      panel: (values, _setField, field) => (
        <AudioCapture
          pattern={feed}
          input={(toProps(values) as unknown as AudioParameters).input}
          controls={field('input')}
        />
      )
    };
  }
  if (type === VIDEO_TYPE) {
    return {
      hiddenFields: VIDEO_PANEL_FIELDS,
      panel: (values, setField, field) => (
        <VideoCapture
          pattern={feed}
          saved={saved && videoCaptureOf(saved as VideoParameters)}
          settings={videoCaptureOf(toProps(values) as unknown as VideoParameters)}
          controls={
            <>
              <Group grow align={'flex-start'}>
                {field('input')}
                {field('sampling')}
              </Group>
              <Group grow align={'flex-start'}>
                {field('offset')}
                {field('direction')}
              </Group>
            </>
          }
          onChange={setField}
        />
      )
    };
  }
  return {};
}
