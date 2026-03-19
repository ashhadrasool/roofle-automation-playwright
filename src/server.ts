import express from 'express';
import dotenv from 'dotenv';
import log from './logger';
import { generateQuote, QuoteInput } from './generate-quote';
import { logError, logResult, getErrors, getResults } from './db';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3', 10);

// Concurrency control
let activeJobs = 0;
const queue: Array<{ resolve: () => void }> = [];

async function acquireSlot() {
  if (activeJobs < MAX_CONCURRENT) {
    activeJobs++;
    return;
  }
  await new Promise<void>((resolve) => queue.push({ resolve }));
  activeJobs++;
}

function releaseSlot() {
  activeJobs--;
  const next = queue.shift();
  if (next) next.resolve();
}

// Single quote endpoint
app.post('/generate-quote', async (req, res) => {
  const { address, firstName, lastName, phone, email } = req.body as QuoteInput;

  if (!address || !firstName || !lastName || !phone || !email) {
    res.status(400).json({
      error: 'Missing required fields: address, firstName, lastName, phone, email',
    });
    return;
  }

  const input = { address, firstName, lastName, phone, email };
  log.info(`Queued: ${firstName} ${lastName} at ${address} (active: ${activeJobs}/${MAX_CONCURRENT}, queued: ${queue.length})`);

  try {
    await acquireSlot();
    log.info(`Started: ${firstName} ${lastName} at ${address}`);
    const result = await generateQuote(input);
    log.info(`Completed: ${firstName} ${lastName} at ${address}`);
    logResult(input, result.leadUrl, result);
    res.json({ success: true, data: result });
  } catch (err: any) {
    log.error(`Failed: ${firstName} ${lastName} at ${address} — ${err.message}`);
    logError(input, err.message, err.step || 'unknown');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    releaseSlot();
  }
});

// Batch endpoint — accepts array, processes in parallel with concurrency limit
app.post('/generate-quotes', async (req, res) => {
  const jobs: QuoteInput[] = req.body;

  if (!Array.isArray(jobs) || jobs.length === 0) {
    res.status(400).json({ error: 'Body must be a non-empty array of quote inputs' });
    return;
  }

  log.info(`Batch received: ${jobs.length} jobs (max concurrent: ${MAX_CONCURRENT})`);

  const results = await Promise.allSettled(
    jobs.map(async (job, index) => {
      const { address, firstName, lastName, phone, email } = job;
      if (!address || !firstName || !lastName || !phone || !email) {
        throw new Error(`Job ${index}: missing required fields`);
      }

      const input = { address, firstName, lastName, phone, email };
      await acquireSlot();
      log.info(`Batch [${index + 1}/${jobs.length}] Started: ${firstName} ${lastName}`);
      try {
        const result = await generateQuote(input);
        log.info(`Batch [${index + 1}/${jobs.length}] Completed: ${firstName} ${lastName}`);
        logResult(input, result.leadUrl, result);
        return result;
      } catch (err: any) {
        log.error(`Batch [${index + 1}/${jobs.length}] Failed: ${firstName} ${lastName} — ${err.message}`);
        logError(input, err.message, err.step || 'unknown');
        throw err;
      } finally {
        releaseSlot();
      }
    })
  );

  const response = results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return { success: true, data: r.value, index: i };
    }
    return { success: false, error: r.reason?.message || 'Unknown error', index: i };
  });

  res.json(response);
});

// View errors and results
app.get('/errors', (_req, res) => {
  res.json(getErrors());
});

app.get('/results', (_req, res) => {
  res.json(getResults());
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', activeJobs, queueLength: queue.length, maxConcurrent: MAX_CONCURRENT });
});

app.listen(PORT, () => {
  log.info(`Server running on port ${PORT} (max concurrent: ${MAX_CONCURRENT})`);
});
