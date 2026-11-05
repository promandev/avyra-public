// stdout es el canal JSON-RPC: cualquier console.log/info/debug va a stderr.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { redact } from './redact.ts';
import { runRemote } from './remote.ts';
import { cameraDiagLogTool, inputShape as cameraShape, inputSchema as cameraSchema } from './tools/camera-diag-log.ts';
import { deployStatus } from './tools/deploy-status.ts';
import { containerStatus } from './tools/container-status.ts';

const server = new McpServer({ name: 'avyra', version: '0.1.0' });

async function respond(fn: () => Promise<object>) {
  try {
    const out = redact(await fn()) as Record<string, unknown>;
    return { content: [{ type: 'text' as const, text: JSON.stringify(out, null, 2) }], structuredContent: out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: 'text' as const, text: redact(msg) }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

server.registerTool(
  'camera_diag_log',
  {
    title: 'Diagnóstico de cámaras',
    description:
      'Fallos recientes de las cámaras (tabla camera_diag_log): resumen por cámara/fase/nivel y filas recientes.',
    inputSchema: cameraShape,
    annotations: readOnly,
  },
  (args) => respond(() => cameraDiagLogTool(cameraSchema.parse(args), runRemote)),
);

server.registerTool(
  'deploy_status',
  {
    title: 'Estado del despliegue',
    description:
      'Compara la versión desplegada en el Raspberry con origin/master y da un veredicto (up_to_date, behind, image_pulled_not_running, restarting, unknown).',
    inputSchema: { fetch: z.boolean().default(false).describe('Ejecutar git fetch origin master antes') },
    annotations: readOnly,
  },
  (args) => respond(() => deployStatus({ fetch: args.fetch }, runRemote)),
);

server.registerTool(
  'container_status',
  {
    title: 'Estado de contenedores y host',
    description: 'Contenedores Docker, memoria, disco y procesos del Raspberry, con avisos.',
    inputSchema: {},
    annotations: readOnly,
  },
  () => respond(() => containerStatus(runRemote)),
);

await server.connect(new StdioServerTransport());
