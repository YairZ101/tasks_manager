import { Fragment } from 'react';

export function KeyboardShortcut({ keys }: { keys: readonly string[] }) {
  return <span className="button-shortcut" aria-hidden="true">{keys.map((key, index) => <Fragment key={key}>{index > 0 && <span>+</span>}<kbd>{key}</kbd></Fragment>)}</span>;
}
