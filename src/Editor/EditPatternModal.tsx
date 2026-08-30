import { Modal } from '@mantine/core';

import { type PatternParameters } from '../lib/api';
import {
  type FormValues,
  fromParameters,
  PatternSubForm
} from '../PatternForm/PatternForm';

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
  return (
    <Modal
      opened={editing !== null}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : ''}
      centered
    >
      {editing && (
        <PatternSubForm
          mode={'edit'}
          initial={fromParameters(editing)}
          busy={busy}
          onSubmit={onSubmit}
        />
      )}
    </Modal>
  );
}
