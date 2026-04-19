import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import type { FastifyInstance } from 'fastify';
import {
  notificationQueue,
  activityQueue,
  SchedulerQueue,
  reportQueue,
  dlqQueue,
} from '../queues/index.js';

const BULL_BOARD_PATH = '/admin/queues';

export async function registerBullBoard(app: FastifyInstance): Promise<void> {
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: [
      new BullMQAdapter(notificationQueue),
      new BullMQAdapter(activityQueue),
      new BullMQAdapter(SchedulerQueue),
      new BullMQAdapter(reportQueue),
      new BullMQAdapter(dlqQueue),
    ],
    serverAdapter,
  });

  await app.register(serverAdapter.registerPlugin(), {
    prefix: BULL_BOARD_PATH,
  });

  console.log(`[bull-board] Dashboard available at ${BULL_BOARD_PATH}`);
}