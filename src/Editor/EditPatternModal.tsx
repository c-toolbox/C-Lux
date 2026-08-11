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
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

export function EditPatternModal({
  editing,
  onClose,
  existingNames,
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
          namePlaceholder={editing.name}
          existingNames={existingNames}
          busy={busy}
          onSubmit={onSubmit}
        />
      )}
    </Modal>
  );
}
