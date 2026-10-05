import { useMemo, useState } from 'react';
import { Group, Modal } from '@mantine/core';

import { type PatternParameters } from '../lib/api';
import {
  type FormValues,
  fromParameters,
  PatternSubForm,
  toProps
} from '../PatternForm/PatternForm';
import { PatternPreview } from '../PatternVisualizer/PatternPreview';

interface EditPatternModalProps {
  editing: PatternParameters | null;
  onClose: () => void;
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

export function EditPatternModal({
  editing,
  onClose,
  busy,
  onSubmit
}: EditPatternModalProps) {
  const [current, setCurrent] = useState<FormValues | null>(null);
  const previewProps = useMemo(
    () =>
      editing && current && current.name === editing.name && current.type === editing.type
        ? toProps(current)
        : null,
    [current, editing]
  );

  return (
    <Modal
      opened={editing !== null}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : ''}
      size={'xl'}
      centered
    >
      {editing && (
        <Group align={'flex-start'} gap={'lg'} wrap={'wrap'}>
          <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <PatternSubForm
              mode={'edit'}
              initial={fromParameters(editing)}
              busy={busy}
              onSubmit={onSubmit}
              onValuesChange={setCurrent}
            />
          </div>

          <div style={{ flex: '1 1 260px', maxWidth: 360, margin: '0 auto' }}>
            {previewProps && <PatternPreview type={editing.type} props={previewProps} />}
          </div>
        </Group>
      )}
    </Modal>
  );
}
