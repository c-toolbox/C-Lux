import { Modal } from '@mantine/core';

import { type FormValues, PatternForm } from '../PatternForm/PatternForm';

interface AddPatternModalProps {
  opened: boolean;
  onClose: () => void;
  namePlaceholder: string;
  existingNames: string[];
  busy: boolean;
  onSubmit: (values: FormValues) => void;
}

export function AddPatternModal({
  opened,
  onClose,
  namePlaceholder,
  existingNames,
  busy,
  onSubmit
}: AddPatternModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={'Add pattern'} centered>
      <PatternForm
        key={namePlaceholder}
        namePlaceholder={namePlaceholder}
        existingNames={existingNames}
        busy={busy}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
