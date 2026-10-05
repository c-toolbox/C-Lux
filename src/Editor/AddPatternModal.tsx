import { Modal } from '@mantine/core';

import { DRAFT_CAPTURE } from '../lib/captures';
import { captureFormProps } from '../PatternForm/capture';
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
    <Modal opened={opened} onClose={onClose} title={'Add pattern'} size={'xl'} centered>
      <PatternForm
        key={namePlaceholder}
        namePlaceholder={namePlaceholder}
        existingNames={existingNames}
        busy={busy}
        onSubmit={onSubmit}
        capture={(type) => captureFormProps(type, DRAFT_CAPTURE, null)}
        captureFeed={DRAFT_CAPTURE}
      />
    </Modal>
  );
}
