import { useCallback, useMemo, useState } from 'react';
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
  existingNames: string[];
  onClose: () => void;
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

export function EditPatternModal({
  editing,
  existingNames,
  onClose,
  busy,
  onSubmit
}: EditPatternModalProps) {
  // Tagged with the pattern it came from, so a stale value from a previous edit (whose
  // name may since have changed) is never previewed.
  const [current, setCurrent] = useState<{
    of: PatternParameters;
    values: FormValues;
  } | null>(null);
  const onValuesChange = useCallback(
    (values: FormValues) => {
      if (editing) setCurrent({ of: editing, values });
    },
    [editing]
  );
  const previewProps = useMemo(
    () => (editing && current && current.of === editing ? toProps(current.values) : null),
    [current, editing]
  );
  const otherNames = useMemo(
    () => existingNames.filter((n) => n !== editing?.name),
    [existingNames, editing]
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
              existingNames={otherNames}
              busy={busy}
              onSubmit={onSubmit}
              onValuesChange={onValuesChange}
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
