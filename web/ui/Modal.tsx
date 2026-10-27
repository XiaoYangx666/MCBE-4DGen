/**
 * Desktop alias for the shared dialog shell. Both frontends render the same
 * markup; the browser build imports `Dialog` straight from `web/shared/Dialog`.
 */
export { Dialog as Modal } from '../shared/Dialog';
export type { DialogProps as ModalProps } from '../shared/Dialog';
