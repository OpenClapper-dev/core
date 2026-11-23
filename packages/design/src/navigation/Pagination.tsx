import type { JSX } from "preact";
import { Button } from "../actions/Button";
import { cx } from "../util";

/** Previous / next with a position readout, for tables. For feeds use the `LoadMore` export. */
export interface PaginationProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "onChange"> {
  page: number;
  pageCount: number;
  onChange?: (page: number) => void;
}

export function Pagination({ page = 1, pageCount = 1, onChange, className, ...rest }: PaginationProps) {
  const go = (p: number) => onChange && onChange(Math.max(1, Math.min(pageCount, p)));
  return (
    <nav aria-label="Pages" className={cx("oc-pager", className)} {...rest}>
      <Button variant="quiet" size="sm" icon="chevron-left" label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)} />
      <span className="oc-pager__pos"><strong>{page}</strong> / {pageCount}</span>
      <Button variant="quiet" size="sm" icon="chevron-right" label="Next page" disabled={page >= pageCount} onClick={() => go(page + 1)} />
    </nav>
  );
}

/** A count and a Load more button, for feeds. */
export interface LoadMoreProps {
  shown: number;
  total: number;
  loading?: boolean;
  onMore?: () => void;
  className?: string;
}

export function LoadMore({ shown, total, loading, onMore, className }: LoadMoreProps) {
  return (
    <div className={cx("oc-more", className)}>
      <span>{shown} of {total}</span>
      {shown < total && <Button size="sm" loading={loading} onClick={onMore}>Load more</Button>}
    </div>
  );
}
