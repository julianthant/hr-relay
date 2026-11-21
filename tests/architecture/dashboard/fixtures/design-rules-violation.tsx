export function Violation({ when, onGo }: { when: Date; onGo: () => void }) {
  return <section className="text-[15px] font-[650] font-bold font-mono" style={{ fontWeight: 700, fontSize: "17px", color: "#abc123" }}>
    <div onClick={onGo}>Go</div>
    <span>{when.toLocaleDateString()} {new Intl.DateTimeFormat("en-US").format(when)}</span>
  </section>;
}
