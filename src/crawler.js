const arg = require('arg');
const { Worker } = require('worker_threads');
const chalk = require('chalk');

function is_valid_url(str) {
  var pattern = new RegExp(
    '^(https?:\\/\\/)?' +
      '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' +
      '((\\d{1,3}\\.){3}\\d{1,3}))' +
      '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' +
      '(\\?[;&a-z\\d%_.~+=-]*)?' +
      '(\\#[-a-z\\d_]*)?$',
    'i'
  );
  return !!pattern.test(str);
}

module.exports.run = function (args) {
  const options = arg(
    {
      '--threads': Number,
      '-n': '--threads',
    },
    { argv: args.splice(2) }
  );

  const urls = options._;
  const max_number_of_threads = options['--threads'] || 1;
  let running_threads = [];
  const queue = [];
  const visited_links = [];
  if (urls.length < 1 || !is_valid_url(urls[0])) {
    console.log('%s - Invalid url provided.', chalk.red.bold('ERROR'));
    process.exit(1);
  }

  // handles failed events for workers
  const on_worker_fails = (error) => {
    console.log(`ERROR: ${error}`);
  };

  // handles exit events for workers
  const on_worker_exits = (exit_code) => {
    console.log(`Exit: ${exit_code}`);
  };

  // (Fikayo 28-06-2020) when a worker completes it's task, we filter
  // the links that haven't been visited yet and add them to the bottom of the queue
  // if there is a runnable
  const on_worker_task_complete = ({ result, url, worker_id }) => {
    //add the url to the set of visited links
    visited_links.push(url);
    const queueable_links = get_unchecked_links(result, visited_links);
    for (let queueable in queueable_links) {
      const link = queueable_links[queueable];
      const can_be_added_to_queue = check_queuable_state(queue, link);
      if (can_be_added_to_queue) {
        queue.unshift(link);
      }
    }

    const worker = get_current_worker(running_threads, worker_id);
    const next_runnable_link = queue.pop();
    // if there is nothing left to process in the queue
    // we can terminate & remove worker from thread pool.
    // We take an empty thread pool as a completion of all tasks.
    if (!next_runnable_link) {
      if (running_threads.length) {
        process.exit(0);
      } else {
        running_threads = running_threads.filter(
          (thread) => thread.threadId !== worker.threadId
        );
        worker.terminate();
        return;
      }
    }

    worker.postMessage({
      url: next_runnable_link,
      worker_id,
    });
    // if the queue has more than 1 entry and we have not maxed out our
    // spawnable thread count, we spawn another worker for increased concurrency
    if (queue.length > 0 && running_threads.length < max_number_of_threads) {
      const link_for_concurrent_task = queue.pop();
      const new_worker = new Worker('./src/worker.js');
      new_worker.on('message', on_worker_task_complete);
      new_worker.on('error', on_worker_fails);
      new_worker.on('exit', on_worker_exits);
      running_threads.push(new_worker);
      new_worker.postMessage({
        url: link_for_concurrent_task,
        worker_id: new_worker.threadId,
      });
    }
    console.log('Links found in ', chalk.green(url));
    result.map((res) => console.log('- %s', res));
  };

  // (Fikayo 28-06-2020) only interested in the first valid URL provided
  const url = urls[0];
  console.log('Starting crawler for %s', chalk.blue.bold(url));

  const worker = new Worker('./src/worker.js');
  worker.on('message', on_worker_task_complete);
  worker.on('error', on_worker_fails);
  worker.on('exit', on_worker_exits);
  running_threads.push(worker);
  worker.postMessage({ url, worker_id: worker.threadId });
};

// filters and returns a list of links that haven't been visited
function get_unchecked_links(links, visited_links) {
  return links.filter((link) => !visited_links.includes(link));
}

// checks if a link has already been queued for execution
function check_queuable_state(queue, queuable) {
  return !queue.includes(queuable);
}

function get_current_worker(running_workers, worker_id) {
  const workers = running_workers.filter(
    (worker) => worker.threadId === worker_id
  );
  if (workers.length > 0) {
    // return the first mathching worker
    // NOTE: (Worker Ids are always unique so a match will always return an array with a single entry)
    return workers[0];
  }
  return null;
}
