import { useRef, useState } from 'react';
import {
  TbChevronDown,
  TbChevronUp,
  TbCopy,
  TbCursorText,
  TbFileExport,
  TbFileImport,
  TbGripVertical,
  TbPencil,
  TbPlayerPlay,
  TbTrash
} from 'react-icons/tb';
import {
  ActionIcon,
  Button,
  FileButton,
  Group,
  Modal,
  Stack,
  Text,
  TextInput
} from '@mantine/core';

import { type Scene } from '../lib/api';

interface ManageScenesModalProps {
  opened: boolean;
  onClose: () => void;
  scenes: Scene[];
  busy: boolean;
  editing: string | null;
  onApply: (scene: Scene) => void;
  onEdit: (scene: Scene) => void;
  onRename: (name: string, newName: string, overwrite: boolean) => void;
  onDuplicate: (scene: Scene) => void;
  onMove: (from: number, to: number) => void;
  onDelete: (name: string) => void;
  onExport: (scene: Scene) => void;
  onImport: (file: File) => void;
}

export function ManageScenesModal({
  opened,
  onClose,
  scenes,
  busy,
  editing,
  onApply,
  onEdit,
  onRename,
  onDuplicate,
  onMove,
  onDelete,
  onExport,
  onImport
}: ManageScenesModalProps) {
  const resetFile = useRef<() => void>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const renameTaken = renaming !== null && scenes.some((s) => s.name === renaming.to);

  function clearDrag() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleDrop(index: number) {
    if (dragIndex !== null) onMove(dragIndex, index);
    clearDrag();
  }

  function confirmDelete() {
    const name = confirming;
    setConfirming(null);
    if (name !== null) onDelete(name);
  }

  function confirmRename() {
    const target = renaming;
    setRenaming(null);
    if (target !== null) onRename(target.from, target.to, renameTaken);
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={'Manage scenes'}
        centered
        size={'xl'}
      >
        <Stack gap={'md'}>
          <Group>
            <FileButton
              resetRef={resetFile}
              accept={'application/json,.json'}
              onChange={(file) => {
                if (!file) return;
                onImport(file);
                // Clear the input so picking the same file again still fires onChange.
                resetFile.current?.();
              }}
            >
              {(props) => (
                <Button
                  {...props}
                  variant={'default'}
                  disabled={busy}
                  leftSection={<TbFileImport />}
                >
                  Import scene…
                </Button>
              )}
            </FileButton>
          </Group>
          {scenes.length === 0 ? (
            <Text c={'dimmed'} ta={'center'} py={'md'}>
              No scenes yet. Save one from the editor page or import one.
            </Text>
          ) : (
            <Stack gap={'sm'}>
              {scenes.map((scene, i) => (
                <SceneRow
                  key={scene.name}
                  scene={scene}
                  index={i}
                  count={scenes.length}
                  busy={busy}
                  editing={editing === scene.name}
                  dragging={dragIndex === i}
                  dropTarget={dragOverIndex === i}
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    setDragOverIndex(i);
                  }}
                  onDrop={() => handleDrop(i)}
                  onMove={onMove}
                  onApply={onApply}
                  onEdit={onEdit}
                  onRename={(from, to) => setRenaming({ from, to })}
                  onDuplicate={onDuplicate}
                  onDelete={setConfirming}
                  onExport={onExport}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={confirming !== null}
        onClose={() => setConfirming(null)}
        title={'Delete scene'}
        centered
        zIndex={300}
      >
        <Stack gap={'md'}>
          <Text>Delete the scene &ldquo;{confirming}&rdquo;? This cannot be undone.</Text>
          <Group justify={'flex-end'} gap={'xs'}>
            <Button variant={'default'} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              color={'red'}
              disabled={busy}
              leftSection={<TbTrash />}
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={renaming !== null}
        onClose={() => setRenaming(null)}
        title={'Rename scene'}
        centered
        zIndex={300}
      >
        <Stack gap={'md'}>
          <Text>
            Rename the scene &ldquo;{renaming?.from}&rdquo; to &ldquo;{renaming?.to}
            &rdquo;?
          </Text>
          {renameTaken && (
            <Text c={'red'}>
              A scene named &ldquo;{renaming?.to}&rdquo; already exists and will be
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

interface SceneRowProps {
  scene: Scene;
  index: number;
  count: number;
  busy: boolean;
  editing: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onMove: (from: number, to: number) => void;
  onApply: (scene: Scene) => void;
  onEdit: (scene: Scene) => void;
  onRename: (name: string, newName: string) => void;
  onDuplicate: (scene: Scene) => void;
  onDelete: (name: string) => void;
  onExport: (scene: Scene) => void;
}

// A single editable row in the manage-scenes modal: reorder, apply, edit, rename,
// duplicate, export, or delete a scene.
function SceneRow({
  scene,
  index,
  count,
  busy,
  editing,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
  onApply,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
  onExport
}: SceneRowProps) {
  const [name, setName] = useState(scene.name);
  const trimmed = name.trim();
  const changed = trimmed !== '' && trimmed !== scene.name;

  return (
    <Group
      align={'center'}
      justify={'space-between'}
      gap={'xs'}
      p={'sm'}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        borderRadius: 8,
        opacity: dragging ? 0.5 : 1,
        border: dropTarget
          ? '2px solid var(--mantine-color-blue-5)'
          : '1px solid var(--mantine-color-default-border)'
      }}
    >
      <Group align={'center'} gap={4} style={{ flex: '1 1 320px' }}>
        <ActionIcon
          variant={'subtle'}
          color={'gray'}
          draggable={!busy}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          style={{ cursor: 'grab' }}
          aria-label={'Drag to reorder'}
        >
          <TbGripVertical />
        </ActionIcon>
        <Stack gap={2}>
          <ActionIcon
            variant={'subtle'}
            color={'gray'}
            size={'sm'}
            disabled={busy || index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={'Move scene up'}
          >
            <TbChevronUp />
          </ActionIcon>
          <ActionIcon
            variant={'subtle'}
            color={'gray'}
            size={'sm'}
            disabled={busy || index === count - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={'Move scene down'}
          >
            <TbChevronDown />
          </ActionIcon>
        </Stack>
        <TextInput
          aria-label={'Scene name'}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
      </Group>
      <Group gap={'xs'}>
        <Button
          size={'xs'}
          variant={'light'}
          disabled={busy}
          leftSection={<TbPlayerPlay />}
          onClick={() => onApply(scene)}
        >
          Apply
        </Button>
        <Button
          size={'xs'}
          variant={editing ? 'filled' : 'light'}
          color={'blue'}
          disabled={busy}
          leftSection={<TbPencil />}
          onClick={() => onEdit(scene)}
        >
          Edit
        </Button>
        <Button
          size={'xs'}
          disabled={busy || !changed}
          leftSection={<TbCursorText />}
          onClick={() => onRename(scene.name, trimmed)}
        >
          Rename
        </Button>
        <Button
          size={'xs'}
          variant={'light'}
          color={'gray'}
          disabled={busy}
          leftSection={<TbCopy />}
          onClick={() => onDuplicate(scene)}
        >
          Duplicate
        </Button>
        <Button
          size={'xs'}
          variant={'light'}
          color={'gray'}
          leftSection={<TbFileExport />}
          onClick={() => onExport(scene)}
        >
          Export
        </Button>
        <Button
          size={'xs'}
          color={'red'}
          variant={'light'}
          disabled={busy}
          leftSection={<TbTrash />}
          onClick={() => onDelete(scene.name)}
        >
          Delete
        </Button>
      </Group>
    </Group>
  );
}
