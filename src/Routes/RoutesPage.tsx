import { Link } from 'react-router-dom';
import { Button, Container, Group, Paper, Stack, Text, Title } from '@mantine/core';

const ROUTES = [
  { path: '/', name: 'Home', description: 'Pick the scene the lights are showing.' },
  {
    path: '/editor',
    name: 'Editor',
    description: 'Build and arrange scenes and their patterns.'
  },
  {
    path: '/debug',
    name: 'Debug',
    description: 'Walk the ring one light at a time to check wiring.'
  },
  {
    path: '/config',
    name: 'Config',
    description: 'Server, Art-Net and light remap settings.'
  },
  { path: '/routes', name: 'Routes', description: 'This page.' }
];

export function RoutesPage() {
  return (
    <Container fluid w={'100%'} px={'5%'} py={'xl'}>
      <Group justify={'space-between'} align={'center'} gap={'xs'}>
        <Title order={1} ta={'left'}>
          C-Lux pages
        </Title>
        <Button component={Link} to={'/'} variant={'default'}>
          Home
        </Button>
      </Group>

      <Stack mt={'xl'} maw={520} mx={'auto'}>
        {ROUTES.map((route) => (
          <Paper
            key={route.path}
            component={Link}
            to={route.path}
            p={'md'}
            ta={'left'}
            withBorder
          >
            <Group justify={'space-between'} align={'center'} gap={'md'} wrap={'nowrap'}>
              <Stack gap={4}>
                <Text fw={600}>{route.name}</Text>
                <Text size={'sm'} c={'dimmed'}>
                  {route.description}
                </Text>
              </Stack>
              <Text size={'sm'} c={'dimmed'} ff={'monospace'}>
                {route.path}
              </Text>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Container>
  );
}
