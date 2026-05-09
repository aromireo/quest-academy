import { useState } from 'react'
import LoadingScreen from '../components/LoadingScreen.jsx'
import Notepad from '../components/Notepad.jsx'

export default function QuestScreen({
  quest, lesson, showLesson, questReady,
  loading, error, subject, questStep, allQuestions, currentQ,
  isIntro, isBoss, answerState, selectedAnswer,
  explanation, explanationLoading,
  followupInput, followupChecked,
  stretchOffer, stretchAnswered,
  profile,
  onDismissLesson, onBeginQuest, onAnswer, onProceed,
  onFollowupChange, onFollowupCheck,
  onStretchAnswer, onStretchDismiss,
  onBack, onRetry,
}) {
  // Notepad open state — persists for the duration of this QuestScreen mount
  // (i.e. across questions in the same quest, but resets between quests).
  const [notepadOpen, setNotepadOpen] = useState(false)

  if (loading) return <LoadingScreen message={`Preparing your ${subject?.label} quest…`} />

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16 }}>
      <div style={{ fontSize: 52 }}>⚠️</div>
      <div style={{ color: '#fca5a5', fontSize: 18, fontWeight: 800 }}>Quest failed to load</div>
      <div style={{
        color: 'var(--text-muted)', fontSize: 13, textAlign: 'center',
        maxWidth: 340, wordBreak: 'break-word', background: 'var(--bg-card)',
        borderRadius: 12, padding: '12px 16px',
      }}>{error}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 280 }}>
        <button onClick={onRetry} style={btnStyle('#6366f1')}>🔄 Retry Quest</button>
        <button onClick={onBack} style={btnStyle('#475569', '#f1f5f9', '#475569')}>← Back to Quests</button>
      </div>
    </div>
  )

  const cardStyle = {
    background: '#fff', borderRadius: 24, padding: '24px 20px',
    maxWidth: 560, margin: '0 auto', boxShadow: '0 16px 60px rgba(0,0,0,0.4)',
    color: '#1a1a2e',
  }

  // ── Lesson screen ─────────────────────────────────────────────────────────
  if (showLesson) return (
    <div style={{ minHeight: '100vh', padding: '20px 16px', display: 'flex', alignItems: 'center' }}>
      <div style={{ ...cardStyle, borderTop: `5px solid ${subject?.color}` }} className="animate-pop">
        <button onClick={onBack} style={{
          background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 700,
          marginBottom: 12, padding: 0,
        }}>← Back</button>

        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 44 }}>{subject?.emoji}</span>
        </div>
        <div style={{
          textAlign: 'center', fontSize: 11, fontWeight: 800,
          color: subject?.color, letterSpacing: 1.5, marginBottom: 6,
        }}>
          QUICK LESSON
        </div>
        <h2 style={{
          fontFamily: 'var(--font-display)', textAlign: 'center', fontSize: 22,
          color: '#1a1a2e', marginBottom: 16,
        }}>
          {lesson?.topic || subject?.label}
        </h2>

        {!lesson ? (
          <LessonSkeleton color={subject?.color} />
        ) : (
          <>
            {lesson.hook && (
              <div style={{
                background: `${subject?.color}11`, borderRadius: 12,
                padding: '12px 14px', fontSize: 14, color: '#1e293b',
                lineHeight: 1.5, marginBottom: 12,
                borderLeft: `4px solid ${subject?.color}`,
              }}>
                💡 {lesson.hook}
              </div>
            )}
            <div style={{
              fontSize: 14.5, color: '#334155', lineHeight: 1.65,
              marginBottom: 12, whiteSpace: 'pre-wrap',
            }}>
              {lesson.lesson}
            </div>
            {Array.isArray(lesson.keyTerms) && lesson.keyTerms.length > 0 && (
              <div style={{
                background: '#f0fdf4', borderRadius: 10, padding: '10px 14px',
                marginBottom: 12, border: '1px solid #bbf7d0',
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#166534', letterSpacing: 1, marginBottom: 6 }}>
                  📚 KEY TERMS
                </div>
                {lesson.keyTerms.map((kt, i) => (
                  <div key={i} style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.5, marginBottom: 4 }}>
                    <strong>{kt.term}:</strong> {kt.definition}
                  </div>
                ))}
              </div>
            )}
            {lesson.watchOut && (
              <div style={{
                background: '#fef9c3', borderRadius: 10, padding: '10px 14px',
                fontSize: 13, color: '#713f12', lineHeight: 1.5, marginBottom: 16,
              }}>
                <strong>👀 Watch out:</strong> {lesson.watchOut}
              </div>
            )}
          </>
        )}

        <button
          onClick={onDismissLesson}
          disabled={!questReady}
          style={{
            ...btnStyle(subject?.color), width: '100%',
            opacity: questReady ? 1 : 0.6,
          }}
        >
          {questReady
            ? "I'm ready — Start Questions →"
            : 'Preparing questions…'}
        </button>
        {!questReady && (
          <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
            Read the lesson while we prep your quest
          </div>
        )}
      </div>
    </div>
  )

  // ── Quest intro ────────────────────────────────────────────────────────────
  if (isIntro && quest) return (
    <div style={{ minHeight: '100vh', padding: '20px 16px', display: 'flex', alignItems: 'center' }}>
      <div style={{ ...cardStyle, borderTop: `5px solid ${subject?.color}` }} className="animate-pop">
        <button onClick={onBack} style={{ background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 700, marginBottom: 16, padding: 0 }}>← Back</button>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 52 }}>{subject?.emoji}</span>
        </div>
        <h2 style={{
          fontFamily: 'var(--font-display)', textAlign: 'center', fontSize: 20,
          color: subject?.color, marginBottom: 16,
        }}>
          {quest.questTitle}
        </h2>
        <div style={{
          background: '#f8fafc', borderRadius: 12, padding: 16, fontSize: 15,
          lineHeight: 1.65, color: '#334155', fontStyle: 'italic',
          borderLeft: `4px solid ${subject?.color}`, marginBottom: 20,
        }}>
          {quest.storyIntro}
        </div>
        <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13, marginBottom: 20 }}>
          📝 5 Questions + 🛡️ Mini Boss + ⚔️ Big Boss
        </div>
        <button
          onClick={onBeginQuest}
          style={{ ...btnStyle(subject?.color), width: '100%' }}
        >
          Begin Quest! ⚔️
        </button>
      </div>
    </div>
  )

  if (!currentQ) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 48 }}>🤔</div>
      <p style={{ color: 'var(--text-muted)' }}>Something went wrong</p>
      <button onClick={onBack} style={{ ...btnStyle('#6366f1'), maxWidth: 200 }}>← Back to Quests</button>
    </div>
  )

  // Boss kind drives label & color. Falls back to legacy isBoss for safety.
  const bossKind = currentQ.kind === 'miniBoss' ? 'mini'
                 : currentQ.kind === 'bigBoss' ? 'big'
                 : (isBoss ? 'big' : null)

  const bossLabel = bossKind === 'mini' ? '🛡️ MINI BOSS'
                  : bossKind === 'big'  ? '⚔️ BIG BOSS'
                  : null

  const bossBadgeStyle = bossKind === 'mini'
    ? { background: 'linear-gradient(135deg, #f97316, #f59e0b)', color: '#fff' }
    : bossKind === 'big'
      ? { background: 'linear-gradient(135deg, #dc2626, #9333ea)', color: '#fff' }
      : { background: '#f1f5f9', color: '#475569' }

  // Total module questions = first 5; bosses are positions 6 and 7.
  // Progress label is "X / 5" while in modules; bosses get their own badge.
  const moduleTotal = 5
  const inModules = !bossKind && questStep >= 1 && questStep <= moduleTotal

  // Decide which follow-up to use:
  //   - Wrong-answer path: explanation.transferQuestion (now MC)
  //   - Correct-answer path: currentQ.followUp (legacy free-text "let's go deeper")
  const useTransfer = !!(explanation?.transferQuestion)
  const transferIsMC = useTransfer
    && Array.isArray(explanation?.transferOptions)
    && explanation.transferOptions.length === 4
    && !!explanation.transferCorrect

  const followUpText   = useTransfer ? explanation.transferQuestion : currentQ.followUp
  const followUpAnswer = useTransfer ? (explanation.transferCorrect || explanation.transferAnswer) : currentQ.followUpAnswer

  // ── Question screen ──────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', padding: '20px 16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <div style={{ ...cardStyle, width: '100%' }} className="animate-fade">
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ color: subject?.color, fontWeight: 800, fontSize: 14 }}>
            {subject?.emoji} {subject?.label}
          </span>
          <span style={{
            ...bossBadgeStyle,
            borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 800,
          }}>
            {bossLabel || `${questStep} / ${moduleTotal}`}
          </span>
        </div>

        {/* Progress bar — only during modules, not bosses */}
        {inModules && (
          <div style={{ height: 4, background: '#f1f5f9', borderRadius: 4, marginBottom: 20, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: `linear-gradient(90deg, ${subject?.color}, ${subject?.color}88)`,
              width: `${(questStep / moduleTotal) * 100}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        )}

        {/* Question */}
        <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.6, color: '#1e293b', marginBottom: 20 }}>
          {currentQ.question}
        </div>

        {/* Options */}
        {!answerState && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(currentQ.options || []).map((opt, i) => (
              <button
                key={i}
                onClick={() => onAnswer(opt)}
                style={{
                  padding: '13px 16px', borderRadius: 10, textAlign: 'left',
                  background: '#f8fafc', border: `2px solid ${subject?.color}33`,
                  fontSize: 15, color: '#1e293b', fontWeight: 600,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = subject?.color; e.currentTarget.style.background = '#f0f9ff' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${subject?.color}33`; e.currentTarget.style.background = '#f8fafc' }}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Correct */}
        {answerState === 'correct' && (
          <FeedbackBox color="#065f46" bg="#d1fae5" border="#6ee7b7">
            <div style={{ fontSize: 40 }}>✅</div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Correct!</div>
            <button onClick={onProceed} style={{ ...btnStyle('#059669'), marginTop: 12 }}>Next →</button>
          </FeedbackBox>
        )}

        {/* Follow-up after correct (static, free-text) */}
        {answerState === 'followup' && (
          <FeedbackBox color="#1e3a5f" bg="#eff6ff" border="#93c5fd">
            <div style={{ fontSize: 22, marginBottom: 4 }}>🧠 Let's go deeper!</div>
            <div style={{ fontWeight: 700, fontSize: 15, margin: '10px 0', color: '#1e293b' }}>
              {currentQ.followUp}
            </div>
            <input
              autoFocus
              value={followupInput}
              onChange={e => onFollowupChange(e.target.value)}
              placeholder="Your answer…"
              style={inputStyle}
            />
            {!followupChecked ? (
              <button
                onClick={onFollowupCheck}
                style={{ ...btnStyle('#3b82f6'), marginTop: 10, width: '100%' }}
              >
                Check My Answer
              </button>
            ) : (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, color: '#475569', background: '#f8fafc', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                  <strong>Model answer:</strong> {currentQ.followUpAnswer}
                </div>
                <button onClick={onProceed} style={{ ...btnStyle('#059669'), width: '100%' }}>
                  Continue →
                </button>
              </div>
            )}
          </FeedbackBox>
        )}

        {/* Wrong + explanation + transfer follow-up (MC) */}
        {(answerState === 'wrong' || answerState === 'explanation') && (
          <FeedbackBox color="#92400e" bg="#fffbeb" border="#fcd34d">
            {answerState === 'wrong' && (
              <div style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🤔</div>
                <div style={{ fontWeight: 700 }}>Thinking of a good explanation…</div>
              </div>
            )}
            {answerState === 'explanation' && explanation && (
              <>
                <div style={{ fontSize: 28 }}>💡</div>
                <div style={{ fontWeight: 800, color: '#92400e', marginBottom: 6 }}>{explanation.encouragement}</div>
                <div style={{ color: '#1e293b', marginBottom: 10, lineHeight: 1.6 }}>{explanation.explanation}</div>
                <div style={{
                  background: '#fef3c7', borderRadius: 8, padding: '8px 12px',
                  fontSize: 13, color: '#78350f', marginBottom: 14,
                }}>
                  🧪 <strong>Memory Tip:</strong> {explanation.memoryTip}
                </div>
                <div style={{
                  fontWeight: 800, marginBottom: 6, color: '#1e293b',
                  display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                }}>
                  {useTransfer ? '🎯 Apply it in a new way:' : 'Follow-up — lock it in:'}
                </div>
                <div style={{ fontSize: 14, color: '#334155', marginBottom: 10, textAlign: 'left' }}>
                  {followUpText}
                </div>

                {/* Multiple-choice transfer (preferred path) */}
                {transferIsMC && !followupChecked && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                    {explanation.transferOptions.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => onFollowupChange(opt)}
                        style={{
                          padding: '11px 14px', borderRadius: 10, textAlign: 'left',
                          background: followupInput === opt ? '#fef3c7' : '#fff',
                          border: `2px solid ${followupInput === opt ? '#f59e0b' : '#fcd34d'}`,
                          fontSize: 14, color: '#1e293b', fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {/* Free-text fallback if MC unavailable */}
                {!transferIsMC && !followupChecked && (
                  <input
                    value={followupInput}
                    onChange={e => onFollowupChange(e.target.value)}
                    placeholder="Your answer…"
                    style={inputStyle}
                  />
                )}

                {!followupChecked ? (
                  <button
                    onClick={onFollowupCheck}
                    disabled={!followupInput}
                    style={{
                      ...btnStyle('#d97706'), marginTop: 10, width: '100%',
                      opacity: followupInput ? 1 : 0.5,
                    }}
                  >
                    Check
                  </button>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 13, color: '#475569', background: '#fff', borderRadius: 8, padding: '8px 12px', marginBottom: 6, textAlign: 'left' }}>
                      <strong>{transferIsMC ? 'Correct answer:' : 'Answer:'}</strong> {followUpAnswer}
                    </div>
                    {transferIsMC && explanation.transferRationale && (
                      <div style={{ fontSize: 13, color: '#475569', background: '#f8fafc', borderRadius: 8, padding: '8px 12px', marginBottom: 10, textAlign: 'left' }}>
                        {explanation.transferRationale}
                      </div>
                    )}
                    <button onClick={onProceed} style={{ ...btnStyle('#059669'), width: '100%' }}>
                      Continue →
                    </button>
                  </div>
                )}
              </>
            )}
          </FeedbackBox>
        )}
      </div>

      {/* Stretch overlay */}
      {stretchOffer && (
        <StretchModal
          offer={stretchOffer}
          answered={stretchAnswered}
          onAnswer={onStretchAnswer}
          onDismiss={onStretchDismiss}
        />
      )}

      {/* Floating notepad — available on every quest, every subject */}
      <Notepad
        open={notepadOpen}
        onToggle={() => setNotepadOpen(v => !v)}
        subjectColor={subject?.color || '#6366f1'}
      />
    </div>
  )
}

// ── Stretch question modal ───────────────────────────────────────────────────
function StretchModal({ offer, answered, onAnswer, onDismiss }) {
  const [picked, setPicked] = useState(null)

  const isCorrect = answered === 'correct'

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,15,30,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, zIndex: 200,
    }}>
      <div style={{
        background: '#fff', borderRadius: 22, padding: '24px 22px',
        maxWidth: 440, width: '100%', color: '#1a1a2e',
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
        borderTop: '6px solid #f59e0b',
      }} className="animate-pop">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 44 }}>🚀</span>
        </div>
        <div style={{
          textAlign: 'center', fontSize: 11, fontWeight: 800,
          color: '#f59e0b', letterSpacing: 2, marginBottom: 4,
        }}>
          STRETCH QUESTION · +30 XP
        </div>
        <h3 style={{
          fontFamily: 'var(--font-display)', textAlign: 'center', fontSize: 18,
          marginBottom: 14, color: '#1a1a2e',
        }}>
          One Grade Above
        </h3>

        {!answered && (
          <>
            <div style={{ fontSize: 15, color: '#1e293b', marginBottom: 14, lineHeight: 1.55 }}>
              {offer.question}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {(offer.options || []).map((opt, i) => (
                <button
                  key={i}
                  onClick={() => setPicked(opt)}
                  style={{
                    padding: '11px 14px', borderRadius: 10, textAlign: 'left',
                    background: picked === opt ? '#fef3c7' : '#f8fafc',
                    border: `2px solid ${picked === opt ? '#f59e0b' : '#e2e8f0'}`,
                    fontSize: 14, color: '#1e293b', fontWeight: 600,
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={onDismiss}
                style={{
                  flex: 1, padding: '11px', background: '#f1f5f9',
                  color: '#475569', borderRadius: 10, fontWeight: 700, fontSize: 13,
                }}
              >
                Skip
              </button>
              <button
                onClick={() => picked && onAnswer(picked)}
                disabled={!picked}
                style={{
                  flex: 2, padding: '11px',
                  background: 'linear-gradient(135deg,#f59e0b,#dc2626)',
                  color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 14,
                }}
              >
                Lock In Answer
              </button>
            </div>
          </>
        )}

        {answered && (
          <>
            <div style={{
              textAlign: 'center', fontSize: 38, marginBottom: 6,
            }}>
              {isCorrect ? '🏆' : '💪'}
            </div>
            <div style={{
              textAlign: 'center', fontWeight: 800, fontSize: 18,
              color: isCorrect ? '#065f46' : '#92400e', marginBottom: 8,
            }}>
              {isCorrect ? 'Stretch crushed!' : 'Good attempt!'}
            </div>
            {isCorrect && (
              <div style={{
                textAlign: 'center', color: '#059669', fontSize: 14, fontWeight: 700, marginBottom: 12,
              }}>
                +30 XP · Stretch Goal badge unlocked
              </div>
            )}
            <div style={{
              background: '#f8fafc', borderRadius: 10, padding: '10px 14px',
              fontSize: 13, color: '#334155', lineHeight: 1.55, marginBottom: 14,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                Correct: {offer.correctAnswer}
              </div>
              {offer.explanation}
            </div>
            <button
              onClick={onDismiss}
              style={{
                width: '100%', padding: '12px',
                background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 14,
              }}
            >
              Back to Quest →
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function LessonSkeleton({ color }) {
  const bar = (w) => ({
    height: 12, borderRadius: 6, width: w,
    background: `linear-gradient(90deg, ${color}11, ${color}33, ${color}11)`,
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s linear infinite',
    marginBottom: 8,
  })
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={bar('100%')} />
      <div style={bar('92%')} />
      <div style={bar('80%')} />
      <div style={bar('70%')} />
      <div style={{ ...bar('60%'), marginTop: 14 }} />
      <div style={bar('85%')} />
    </div>
  )
}

function FeedbackBox({ color, bg, border, children }) {
  return (
    <div style={{
      background: bg, border: `2px solid ${border}`,
      borderRadius: 16, padding: 20, color, textAlign: 'center',
    }} className="animate-pop">
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 8,
  border: '2px solid #e2e8f0', fontSize: 15, fontFamily: 'var(--font-body)',
  outline: 'none', textAlign: 'center', boxSizing: 'border-box',
}

function btnStyle(bg, btnBg, textColor) {
  return {
    padding: '12px 24px', borderRadius: 10,
    background: btnBg || `linear-gradient(135deg, ${bg}, ${bg}cc)`,
    color: textColor || '#fff', fontWeight: 800, fontSize: 15,
  }
}
