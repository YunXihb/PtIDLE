import { redisClient } from '../config/redis';

// Redis key for the gathering task queue (sorted set)
const GATHERING_QUEUE_KEY = 'idle:gathering:queue';

// Redis key prefix for individual user task locks
const GATHERING_LOCK_PREFIX = 'idle:gathering:lock:';

// Lock TTL in seconds (prevent duplicate processing)
const LOCK_TTL = 60;

/**
 * Add a gathering task to the Redis queue
 * @param userId User ID
 * @param skillType Skill type (mining, woodcutting, herbalism)
 * @param completionTime Timestamp when the task will be completed
 */
export async function enqueueGatheringTask(
  userId: string,
  skillType: string,
  completionTime: number
): Promise<void> {
  const taskData = JSON.stringify({
    userId,
    skillType,
    enqueuedAt: Date.now(),
  });

  // Add to sorted set with completion time as score
  await redisClient.zAdd(GATHERING_QUEUE_KEY, {
    score: completionTime,
    value: taskData,
  });
}

/**
 * Get all due gathering tasks from the queue
 * @param currentTime Current timestamp (tasks with score <= currentTime are due)
 * @returns Array of due tasks
 */
export async function getDueGatheringTasks(currentTime: number): Promise<Array<{
  userId: string;
  skillType: string;
  enqueuedAt: number;
}>> {
  // Get all tasks with score <= currentTime
  const tasks = await redisClient.zRangeByScore(GATHERING_QUEUE_KEY, 0, currentTime);

  return tasks.map((task) => JSON.parse(task));
}

/**
 * Remove a task from the queue
 * @param userId User ID
 * @param skillType Skill type
 * @param enqueuedAt Enqueue timestamp
 */
export async function removeGatheringTask(
  userId: string,
  skillType: string,
  enqueuedAt: number
): Promise<void> {
  const taskData = JSON.stringify({
    userId,
    skillType,
    enqueuedAt,
  });

  await redisClient.zRem(GATHERING_QUEUE_KEY, taskData);
}

/**
 * Try to acquire a lock for processing a user's gathering task
 * @param userId User ID
 * @returns true if lock acquired, false otherwise
 */
export async function acquireGatheringLock(userId: string): Promise<boolean> {
  const lockKey = `${GATHERING_LOCK_PREFIX}${userId}`;

  // SET NX with expiry - only succeeds if key doesn't exist
  const result = await redisClient.set(lockKey, '1', {
    NX: true,
    EX: LOCK_TTL,
  });

  return result === 'OK';
}

/**
 * Release a user's gathering lock
 * @param userId User ID
 */
export async function releaseGatheringLock(userId: string): Promise<void> {
  const lockKey = `${GATHERING_LOCK_PREFIX}${userId}`;
  await redisClient.del(lockKey);
}

/**
 * Check if a user has an active gathering task in the queue
 * @param userId User ID
 * @returns true if user has an active task
 */
export async function hasActiveGatheringTask(userId: string): Promise<boolean> {
  // Check if any task for this user exists in the queue
  const allTasks = await redisClient.zRange(GATHERING_QUEUE_KEY, 0, -1);

  for (const taskStr of allTasks) {
    const task = JSON.parse(taskStr);
    if (task.userId === userId) {
      return true;
    }
  }

  return false;
}

/**
 * Clear all gathering tasks from the queue (for testing)
 */
export async function clearGatheringQueue(): Promise<void> {
  await redisClient.del(GATHERING_QUEUE_KEY);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pendingTasks: number;
  oldestTask: number | null;
  newestTask: number | null;
}> {
  const pendingTasks = await redisClient.zCard(GATHERING_QUEUE_KEY);

  let oldestTask: number | null = null;
  let newestTask: number | null = null;

  if (pendingTasks > 0) {
    const oldest = await redisClient.zRange(GATHERING_QUEUE_KEY, 0, 0);
    const newest = await redisClient.zRange(GATHERING_QUEUE_KEY, -1, -1);

    if (oldest.length > 0) {
      oldestTask = JSON.parse(oldest[0]).enqueuedAt;
    }
    if (newest.length > 0) {
      newestTask = JSON.parse(newest[0]).enqueuedAt;
    }
  }

  return {
    pendingTasks,
    oldestTask,
    newestTask,
  };
}
