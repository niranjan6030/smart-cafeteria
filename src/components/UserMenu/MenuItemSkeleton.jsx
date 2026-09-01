// ─── MenuItemSkeleton — shimmer placeholder matching MenuItemCard's shape ─────
// Prevents grid reflow while the products snapshot loads. Mirrors the compact
// food card layout (floating rounded image "plate" on top, dense body lines
// below) so there is no visual jump when the real card streams in.
export default function MenuItemSkeleton() {
  return (
    <div className="cc-card flex flex-col overflow-hidden">
      <div className="p-2 pb-0">
        <div className="cc-skeleton aspect-[4/3] w-full rounded-[1rem]" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 pt-2.5">
        <div className="cc-skeleton h-3 w-28 rounded-full" />
        <div className="cc-skeleton h-2.5 w-20 rounded-full" />
        <div className="cc-skeleton h-2 w-24 rounded-full" />
        <div className="mt-auto flex items-center justify-between pt-1.5">
          <div className="cc-skeleton h-3.5 w-12 rounded-full" />
          <div className="cc-skeleton h-9 w-11 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
