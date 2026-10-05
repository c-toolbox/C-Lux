import { useCallback, useMemo, useState } from 'react';
import { TbCursorText } from 'react-icons/tb';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';

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
  onSubmit: (values: FormValues, overwrite: boolean) => void;
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
  // A submitted rename waiting on the user's confirmation.
  const [renaming, setRenaming] = useState<FormValues | null>(null);
  const newName = renaming?.name.trim() ?? '';
  const renameTaken = otherNames.includes(newName);

  function submit(values: FormValues) {
    if (editing && values.name.trim() !== editing.name) setRenaming(values);
    else onSubmit(values, false);
  }

  function confirmRename() {
    const values = renaming;
    setRenaming(null);
    if (values) onSubmit(values, renameTaken);
  }

  return (
    <>
      <Modal
        opened={editing !== null}
        onClose={onClose}
        title={editing ? `Edit ${editing.name}` : ''}
        size={'xl'}
        centered
      >
        {editing && (
          <PatternSubForm
            mode={'edit'}
            initial={fromParameters(editing)}
            existingNames={otherNames}
            busy={busy}
            onSubmit={submit}
            onValuesChange={onValuesChange}
            preview={
              previewProps && <PatternPreview type={editing.type} props={previewProps} />
            }
          />
        )}
      </Modal>

      <Modal
        opened={renaming !== null}
        onClose={() => setRenaming(null)}
        title={'Rename pattern'}
        centered
        zIndex={300}
      >
        <Stack gap={'md'}>
          <Text>
            Rename the pattern &ldquo;{editing?.name}&rdquo; to &ldquo;{newName}&rdquo;?
          </Text>
          {renameTaken && (
            <Text c={'red'}>
              A pattern named &ldquo;{newName}&rdquo; already exists and will be
              overwritten. This cannot be undone.
            </Text>
          )}
          <Group justify={'flex-end'} gap={'xs'}>
            <Button variant={'default'} onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              color={renameTaken ? 'red' : undefined}
              disabled={busy}
              leftSection={<TbCursorText />}
              onClick={confirmRename}
            >
              {renameTaken ? 'Overwrite' : 'Rename'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
