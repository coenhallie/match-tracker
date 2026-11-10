/**
 * After every test, let the event loop turn once.
 *
 * happy-dom caches `querySelector` results in WeakRefs, and V8 keeps the target of a new WeakRef
 * alive until the job that made it is over. Vitest runs synchronous tests back to back without
 * yielding to the event loop, so without a turn every element a file's tests queried, and every
 * widget such an element reaches, stays reachable to the end of the file: about 100 MB a widget
 * test, and out of memory in a long file. Nothing of the widget's own stays reachable after
 * `destroy()`.
 */
import { afterEach } from 'vitest'

afterEach(() => new Promise<void>((done) => setTimeout(done, 0)))
