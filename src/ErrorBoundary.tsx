import { Component, type ReactNode } from 'react';
import { Button, Code, Container, Stack, Text, Title } from '@mantine/core';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches render errors anywhere in the tree so a crash in one panel shows a recovery
// screen instead of blanking the whole UI.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <Container fluid px={'5%'} py={'xl'}>
        <Stack>
          <Title order={2}>Something went wrong</Title>
          <Text>The interface hit an unexpected error and could not continue.</Text>
          <Code block>{error.message}</Code>
          <Button onClick={() => window.location.reload()} w={'fit-content'}>
            Reload
          </Button>
        </Stack>
      </Container>
    );
  }
}
