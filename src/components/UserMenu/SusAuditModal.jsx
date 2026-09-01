import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";

// ─── Layer 3: Post-Order SUS Research Audit Modal ─────────────────────────────
const SUS_QUESTIONS = [
  { key: "q1", text: "I think that I would like to use this system frequently.", tone: "positive" },
  { key: "q2", text: "I found this food marketplace platform unnecessarily complex.", tone: "negative" },
  { key: "q3", text: "I thought the user interface workspace was intuitive and easy to navigate.", tone: "positive" },
];
const LIKERT_LABELS = ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"];

export default function SusAuditModal({ abGroup, frictionData, user, onClose }) {
  const [responses, setResponses] = useState({ q1: 3, q2: 3, q3: 3 });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const computeSusScore = () => {
    const positiveQ1 = responses.q1 - 1;
    const negativeQ2 = 5 - responses.q2;
    const positiveQ3 = responses.q3 - 1;
    const rawSum = positiveQ1 + negativeQ2 + positiveQ3;
    return parseFloat(((rawSum * 100) / 12).toFixed(1));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const susScore = computeSusScore();
      const payload = {
        test_group: abGroup || localStorage.getItem("ab_testing_group") || "Unknown",
        time_to_task_seconds: parseFloat(frictionData?.timeToTaskSeconds || 0),
        click_through_volume: frictionData?.clickThroughVolume || 0,
        modality: frictionData?.modality || "manual",
        sus_score: susScore,
        student_uid: user?.uid || "guest",
        student_email: user?.email || "anonymous",
        responses: { ...responses },
        timestamp: new Date().toISOString(),
        created_at: serverTimestamp(),
      };
      await addDoc(collection(db, "ux_research_audits"), payload);
      setSubmitted(true);
      setTimeout(() => onClose(), 1800);
    } catch (err) {
      console.error("UX audit write failed:", err);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[310] flex items-center justify-center p-4" style={{ animation: "popIn .22s ease-out" }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-lg" />
        <div className="relative rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#1B1B1B] to-[#0B0B0B] px-10 py-14 text-center shadow-2xl">
          <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full border-2 border-[#E06A3B] text-4xl font-black text-[#E06A3B]">✓</div>
          <p className="text-xs font-black uppercase tracking-[0.35em] text-[#E06A3B]">Thank you for your feedback</p>
          <p className="mt-3 text-sm text-white/50">Your response has been recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[310] flex items-end justify-center p-3 sm:items-center sm:p-6" style={{ animation: "popIn .22s ease-out" }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-lg" />
      <section className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-gradient-to-br from-[#1B1B1B] to-[#0B0B0B] shadow-2xl text-white">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/8 p-6 bg-[#161616]">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.35em] text-[#E06A3B]">CampusBites Research</p>
            <h2 className="mt-1 text-xl font-black tracking-tight">Experience Audit</h2>
            <p className="mt-1 text-[11px] text-white/40">Help us improve — takes 15 seconds</p>
          </div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-lg font-bold text-white/50 transition hover:bg-white/10 active:scale-95">×</button>
        </div>

        {/* Questions */}
        <div className="space-y-7 p-6">
          {SUS_QUESTIONS.map((q, idx) => (
            <div key={q.key}>
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.3em] text-white/35">Question {idx + 1} · {q.tone === "positive" ? "Positive" : "Negative"}</p>
              <p className="text-sm font-bold leading-6 text-white/90">{q.text}</p>
              <div className="mt-3 flex gap-2">
                {[1, 2, 3, 4, 5].map((val) => (
                  <button
                    key={val}
                    onClick={() => setResponses((prev) => ({ ...prev, [q.key]: val }))}
                    className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition active:scale-95 ${
                      responses[q.key] === val
                        ? "border-[#E06A3B] bg-[#E06A3B26] text-[#E06A3B]"
                        : "border-white/8 bg-white/3 text-white/50 hover:border-white/20 hover:text-white/70"
                    }`}
                  >
                    <span className="text-lg font-black">{val}</span>
                    <span className="text-[7px] font-bold uppercase tracking-wider leading-tight text-center">{LIKERT_LABELS[val - 1]}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Friction data badge */}
          {frictionData && (
            <div className="flex items-center gap-4 rounded-2xl border border-white/6 bg-white/3 px-5 py-3">
              <div className="flex-1">
                <p className="text-[8px] font-black uppercase tracking-[0.3em] text-white/30">Session Time</p>
                <p className="mt-0.5 text-sm font-black text-[#E06A3B]">{frictionData.timeToTaskSeconds}s</p>
              </div>
              <div className="h-6 w-px bg-white/10" />
              <div className="flex-1">
                <p className="text-[8px] font-black uppercase tracking-[0.3em] text-white/30">Interactions</p>
                <p className="mt-0.5 text-sm font-black text-[#8A6A2F]">{frictionData.clickThroughVolume}</p>
              </div>
              <div className="h-6 w-px bg-white/10" />
              <div className="flex-1">
                <p className="text-[8px] font-black uppercase tracking-[0.3em] text-white/30">Test Group</p>
                <p className="mt-0.5 text-sm font-black text-[#E06A3B]">{abGroup || "—"}</p>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            disabled={submitting}
            onClick={handleSubmit}
            className="w-full rounded-2xl bg-[color:var(--color-primary)] px-5 py-4 text-xs font-black uppercase tracking-[0.25em] text-[color:var(--color-bg-deep)] shadow-lg transition hover:bg-[color:var(--color-primary-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit Research Feedback"}
          </button>

          <button onClick={onClose} className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-white/25 transition hover:text-white/50">
            Skip for now
          </button>
        </div>
      </section>
    </div>
  );
}
