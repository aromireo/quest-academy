import { useState, useEffect, useCallback } from 'react'
import { SUBJECTS, BADGES, BASE_GRADE, STARTING_LEVELS, getLevel } from './lib/constants.js'
import { loadProfiles, saveProfile, deleteProfile, saveQuestResult, loadQuestHistory } from './lib/supabase.js'
import { fetchPoolQuest, generateExplanation, generateStretchQuestion, calcNextDifficulty } from './lib/claude.js'
import HomeScreen from './pages/HomeScreen.jsx'
import SetupScreen from './pages/SetupScreen.jsx'
import ProfileScreen from './pages/ProfileScreen.jsx'
import QuestScreen from './pages/QuestScreen.jsx'
import ResultScreen from './pages/ResultScreen.jsx'
import ParentScreen from './pages/ParentScreen.jsx'
import HouseholdSetup from './pages/HouseholdSetup.jsx'
import Notification from './components/Notification.jsx'
import LoadingScreen from './components/LoadingScreen.jsx'

// ── Household code: stable across devices, replaces per-browser session_id ──
function generateHouseholdCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `QUEST-${s}`
}

function getHouseholdCode() {
  return localStorage.getItem('qa_household_code') || null
}
function setHouseholdCode(code) {
  localStorage.setItem('qa_household_code', code)
}
function getLegacySessionId() {
  return localStorage.getItem('qa_session') || null
}

export default function App() {
  const [screen, setScreen]               = useState('loading')
  const [householdCode, setHouseholdCodeState] = useState(getHouseholdCode())
  const [profiles, setProfiles]           = useState([])
  const [activeProfile, setActiveProfile] = useState(null)
  const [setupSlot, setSetupSlot]         = useState(null)
  const [editingProfile, setEditingProfile] = useState(null)

  // Quest state
  const [quest, setQuest]                 = useState(null)
  const [lesson, setLesson]               = useState(null)
  const [activeSubject, setActiveSubject] = useState(null)
  const [questLoading, setQuestLoading]   = useState(false)
  const [questError, setQuestError]       = useState(null)
  const [questStep, setQuestStep]         = useState(0)
  const [showLesson, setShowLesson]       = useState(false)
  const [questReady, setQuestReady]       = useState(false)
  const [answers, setAnswers]             = useState({})
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [answerState, setAnswerState]     = useState(null)
  const [explanation, setExplanation]     = useState(null)
  const [explanationLoading, setExplanationLoading] = useState(false)
  const [followupInput, setFollowupInput] = useState('')
  const [followupChecked, setFollowupChecked] = useState(false)
  const [streak, setStreak]               = useState(0)
  const [stretchOffer, setStretchOffer]   = useState(null)
  const [stretchAnswered, setStretchAnswered] = useState(null)

  const [questResults, setQuestResults]   = useState(null)
  const [notification, setNotification]   = useState(null)
  const [questHistory, setQuestHistory]   = useState([])

  // ── Boot: ensure household code exists, then load profiles ─────────────────
  useEffect(() => {
    ;(async () => {
      let code = getHouseholdCode()
      const legacy = getLegacySessionId()
      if (!code) {
        code = generateHouseholdCode()
        setHouseholdCode(code)
        setHouseholdCodeState(code)
      }
      try {
        const data = await loadProfiles(code, legacy)
        setProfiles(data || [])
      } catch (e) {
        console.error('Failed to load profiles:', e)
        setProfiles([])
      } finally {
        setScreen('home')
      }
    })()
  }, [])

  const switchHouseholdCode = useCallback(async (code) => {
    const cleanCode = code.trim().toUpperCase()
    if (!cleanCode) return false
    setHouseholdCode(cleanCode)
    setHouseholdCodeState(cleanCode)
    try {
      const data = await loadProfiles(cleanCode, null)
      setProfiles(data || [])
      setActiveProfile(null)
      return true
    } catch (e) {
      console.error('Failed to load profiles for code:', e)
      return false
    }
  }, [])

  // ── Notifications ──────────────────────────────────────────────────────────
  const showNotif = useCallback((msg, emoji = '🎉', duration = 3000) => {
    setNotification({ msg, emoji })
    setTimeout(() => setNotification(null), duration)
  }, [])

  // ── Profile management ─────────────────────────────────────────────────────
  const updateProfile = useCallback(async (updated) => {
    try {
      const saved = await saveProfile(updated)
      setProfiles(prev => {
        const idx = prev.findIndex(p => p.id === saved.id)
        if (idx === -1) return [...prev, saved]
        return prev.map(p => p.id === saved.id ? saved : p)
      })
      if (activeProfile?.id === saved.id) setActiveProfile(saved)
      return saved
    } catch (e) {
      console.error('Failed to save profile:', e)
      return updated
    }
  }, [activeProfile])

  const removeProfile = useCallback(async (profileId) => {
    try {
      await deleteProfile(profileId)
      setProfiles(prev => prev.filter(p => p.id !== profileId))
      if (activeProfile?.id === profileId) setActiveProfile(null)
    } catch (e) {
      console.error('Failed to delete profile:', e)
    }
  }, [activeProfile])

  const addXP = useCallback(async (profile, amount) => {
    const newXP = (profile.xp || 0) + amount
    const oldLevel = getLevel(profile.xp || 0)
    const newLevel = getLevel(newXP)
    const updated = { ...profile, xp: newXP, level: newLevel }
    await updateProfile(updated)
    if (newLevel > oldLevel) showNotif(`⬆️ Level Up! Now Level ${newLevel}!`, '✨')
    return updated
  }, [updateProfile, showNotif])

  const awardBadge = useCallback(async (profile, badgeId) => {
    if ((profile.badges || []).includes(badgeId)) return profile
    const badge = BADGES.find(b => b.id === badgeId)
    const updated = { ...profile, badges: [...(profile.badges || []), badgeId] }
    await updateProfile(updated)
    if (badge) setTimeout(() => showNotif(`Badge: ${badge.label}!`, badge.emoji), 500)
    return updated
  }, [updateProfile, showNotif])

  // ── Setup flow ─────────────────────────────────────────────────────────────
  const startSetup = (slot) => { setSetupSlot(slot); setEditingProfile(null); setScreen('setup') }
  const startEdit  = (profile) => { setEditingProfile(profile); setSetupSlot(profile.slot); setScreen('setup') }

  const completeSetup = async (data) => {
    if (editingProfile) {
      const saved = await updateProfile({
        ...editingProfile,
        name: data.name,
        pronouns: data.pronouns,
        hero_class: data.heroClass,
        avatar: data.avatar,
      })
      showNotif(`Updated, ${data.name}!`, data.avatar)
      setEditingProfile(null)
      setScreen('home')
      return saved
    }

    const grade = setupSlot === 0 ? '6th' : '3rd'
    const baseGrade = BASE_GRADE[grade]
    const startingLevels = STARTING_LEVELS[setupSlot] || {}

    const profile = {
      household_code: householdCode,
      session_id: householdCode,
      slot: setupSlot,
      name: data.name,
      grade,
      base_grade_num: baseGrade,
      pronouns: data.pronouns,
      hero_class: data.heroClass,
      avatar: data.avatar,
      xp: 0,
      level: 1,
      badges: [],
      streak: 0,
      difficulty_levels: {
        math:    startingLevels.math    ?? baseGrade,
        english: startingLevels.english ?? baseGrade,
        science: startingLevels.science ?? baseGrade,
        history: startingLevels.history ?? baseGrade,
        spanish: baseGrade,
        yoruba:  baseGrade,
      },
      difficulty_locked: {},
    }
    const saved = await updateProfile(profile)
    showNotif(`Welcome, ${data.name}!`, data.avatar)
    setScreen('home')
    return saved
  }

  // ── Quest flow ─────────────────────────────────────────────────────────────
  // v11: this now hits the pool endpoint. Should return in <1s on a cache hit.
  const startQuest = async (subjectId) => {
    const subject = SUBJECTS.find(s => s.id === subjectId)
    setActiveSubject(subject)
    setQuestError(null)
    setQuest(null)
    setLesson(null)
    setShowLesson(true)
    setQuestReady(false)
    setQuestResults(null)
    setQuestStep(0)
    setAnswers({})
    setSelectedAnswer(null)
    setAnswerState(null)
    setExplanation(null)
    setExplanationLoading(false)
    setFollowupInput('')
    setFollowupChecked(false)
    setStreak(0)
    setStretchOffer(null)
    setStretchAnswered(null)

    // Switch to quest screen immediately and show "preparing" while we fetch
    setQuestLoading(true)
    setScreen('quest')

    try {
      const { quest: q, lesson: l } = await fetchPoolQuest(subject, activeProfile)
      setQuest(q)
      setLesson(l)
      setQuestReady(true)
      setQuestLoading(false)
    } catch (err) {
      console.error('Quest fetch failed:', err)
      setQuestError(err.message || 'Could not load quest. Please try again.')
      setQuestLoading(false)
    }
  }

  const allQuestions = quest
    ? [...(quest.questions || []), { ...quest.bossQuestion, id: 'boss', isBoss: true }]
    : []
  const currentQ  = allQuestions[questStep - 1]
  const isBoss    = currentQ?.isBoss
  const isIntro   = questStep === 0
  const isDone    = questStep > allQuestions.length && questResults !== null

  const handleAnswer = async (option) => {
    if (answerState) return
    setSelectedAnswer(option)
    const isCorrect = option.trim().toLowerCase() === (currentQ.correctAnswer || '').trim().toLowerCase()

    if (isCorrect) {
      const newStreak = streak + 1
      setStreak(newStreak)
      const doFollowup = isBoss || Math.random() < 0.4
      if (doFollowup) {
        setAnswerState('followup')
      } else {
        setAnswerState('correct')
      }
      if (!isBoss && newStreak > 0 && newStreak % 3 === 0) {
        generateStretchQuestion(activeSubject, activeProfile).then(s => {
          if (s) setStretchOffer(s)
        }).catch(() => {})
      }
    } else {
      setStreak(0)
      setAnswerState('wrong')
      setExplanationLoading(true)
      const exp = await generateExplanation(
        currentQ.question, option, currentQ.correctAnswer, activeProfile, activeSubject
      )
      setExplanation(exp)
      setExplanationLoading(false)
      setAnswerState('explanation')
    }
  }

  const handleStretchAnswer = async (option) => {
    if (!stretchOffer || stretchAnswered) return
    const isCorrect = option.trim().toLowerCase() === (stretchOffer.correctAnswer || '').trim().toLowerCase()
    setStretchAnswered(isCorrect ? 'correct' : 'wrong')
    if (isCorrect) {
      const updated = await addXP(activeProfile, 30)
      await awardBadge(updated, 'stretch')
    }
  }

  const dismissStretch = () => {
    setStretchOffer(null)
    setStretchAnswered(null)
  }

  const proceedNext = async () => {
    const isCorrect = (selectedAnswer || '').trim().toLowerCase() === (currentQ?.correctAnswer || '').trim().toLowerCase()
    const xpEarned = isCorrect ? (isBoss ? 40 : 20) : 5
    const finalAnswers = { ...answers, [currentQ.id]: { correct: isCorrect, selected: selectedAnswer } }

    setAnswers(finalAnswers)
    setSelectedAnswer(null)
    setAnswerState(null)
    setExplanation(null)
    setFollowupInput('')
    setFollowupChecked(false)

    const next = questStep + 1
    setQuestStep(next)

    if (next > allQuestions.length) {
      await finishQuest(finalAnswers, xpEarned)
    } else {
      await addXP(activeProfile, xpEarned)
    }
  }

  const finishQuest = async (finalAnswers, lastXP) => {
    const correct = Object.values(finalAnswers).filter(a => a.correct).length
    const total   = allQuestions.length
    const score   = Math.round((correct / total) * 100)

    setQuestResults({ correct, total, score })

    let prof = await addXP(activeProfile, lastXP)

    const profileId = activeProfile?.id || prof?.id
    try {
      await saveQuestResult({
        profile_id:    profileId,
        subject_id:    activeSubject.id,
        subject_label: activeSubject.label,
        score,
        correct,
        total,
        difficulty:    prof.difficulty_levels?.[activeSubject.id] || prof.base_grade_num,
	strand: quest?.strand || null,
      })
    } catch (e) { console.error('Failed to save result:', e) }

    if (!prof.badges?.includes('first_quest')) prof = await awardBadge(prof, 'first_quest')
    if (score === 100) prof = await awardBadge(prof, 'perfect')

    try {
      const history = await loadQuestHistory(profileId)
      setQuestHistory(history)
      const subjectScores = history
        .filter(h => h.subject_id === activeSubject.id)
        .map(h => h.score)
      const currentDiff = prof.difficulty_levels?.[activeSubject.id] || prof.base_grade_num
      const isLocked = !!(prof.difficulty_locked || {})[activeSubject.id]
      const nextDiff = calcNextDifficulty(currentDiff, subjectScores, isLocked)
      if (nextDiff !== currentDiff) {
        const newLevels = { ...(prof.difficulty_levels || {}), [activeSubject.id]: nextDiff }
        prof = await updateProfile({ ...prof, difficulty_levels: newLevels })
        if (nextDiff > currentDiff) {
          prof = await awardBadge(prof, 'leveled_up')
          showNotif(`Difficulty increased in ${activeSubject.label}!`, '⬆️', 4000)
        }
      }
      const mathScores = history.filter(h => h.subject_id === 'math' && h.score >= 85)
      if (mathScores.length >= 3) prof = await awardBadge(prof, 'math_ace')
      const engScores = history.filter(h => h.subject_id === 'english' && h.score >= 85)
      if (engScores.length >= 3) prof = await awardBadge(prof, 'word_wizard')
    } catch (e) { console.error('Failed to process badges:', e) }

    setScreen('result')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (screen === 'loading') return <LoadingScreen message="Loading your adventure…" />

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-deep)', position: 'relative' }}>
      {notification && <Notification {...notification} />}

      {screen === 'home' && (
        <HomeScreen
          profiles={profiles}
          householdCode={householdCode}
          onSelectProfile={p => {
            setActiveProfile(p)
            setScreen('profile')
          }}
          onSetupProfile={startSetup}
          onParentDash={() => setScreen('parent')}
          onHouseholdSetup={() => setScreen('household')}
        />
      )}

      {screen === 'household' && (
        <HouseholdSetup
          currentCode={householdCode}
          onSwitch={switchHouseholdCode}
          onNew={() => {
            const code = generateHouseholdCode()
            setHouseholdCode(code)
            setHouseholdCodeState(code)
            setProfiles([])
            setActiveProfile(null)
            setScreen('home')
          }}
          onBack={() => setScreen('home')}
          showNotif={showNotif}
        />
      )}

      {screen === 'setup' && (
        <SetupScreen
          slot={setupSlot}
          editing={editingProfile}
          onComplete={completeSetup}
          onBack={() => { setEditingProfile(null); setScreen(editingProfile ? 'parent' : 'home') }}
        />
      )}

      {screen === 'profile' && activeProfile && (
        <ProfileScreen
          profile={profiles.find(p => p.id === activeProfile.id) || activeProfile}
          onStartQuest={startQuest}
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'quest' && (
        <QuestScreen
          quest={quest}
          lesson={lesson}
          showLesson={showLesson}
          questReady={questReady}
          loading={questLoading}
          error={questError}
          subject={activeSubject}
          questStep={questStep}
          allQuestions={allQuestions}
          currentQ={currentQ}
          isIntro={isIntro}
          isBoss={isBoss}
          answerState={answerState}
          selectedAnswer={selectedAnswer}
          explanation={explanation}
          explanationLoading={explanationLoading}
          followupInput={followupInput}
          followupChecked={followupChecked}
          stretchOffer={stretchOffer}
          stretchAnswered={stretchAnswered}
          profile={activeProfile}
          onDismissLesson={() => setShowLesson(false)}
          onBeginQuest={() => setQuestStep(1)}
          onAnswer={handleAnswer}
          onProceed={proceedNext}
          onFollowupChange={setFollowupInput}
          onFollowupCheck={() => setFollowupChecked(true)}
          onStretchAnswer={handleStretchAnswer}
          onStretchDismiss={dismissStretch}
          onBack={() => setScreen('profile')}
          onRetry={() => startQuest(activeSubject?.id)}
        />
      )}

      {screen === 'result' && questResults && (
        <ResultScreen
          results={questResults}
          subject={activeSubject}
          quest={quest}
          profile={profiles.find(p => p.id === activeProfile?.id) || activeProfile}
          onBack={() => { setScreen('profile'); setQuest(null); setQuestResults(null); setQuestStep(0) }}
        />
      )}

      {screen === 'parent' && (
        <ParentScreen
          profiles={profiles}
          questHistory={questHistory}
          householdCode={householdCode}
          onLoadHistory={async (profileId) => {
            try {
              const h = await loadQuestHistory(profileId)
              setQuestHistory(prev => [
                ...prev.filter(r => r.profile_id !== profileId),
                ...h,
              ])
            } catch {}
          }}
          onUpdateProfile={updateProfile}
          onEditProfile={startEdit}
          onDeleteProfile={removeProfile}
          onBack={() => setScreen('home')}
          showNotif={showNotif}
        />
      )}
    </div>
  )
}
