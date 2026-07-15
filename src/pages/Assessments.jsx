import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import PageHeader from '../components/PageHeader.jsx'
import AssessmentCard from '../components/AssessmentCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { useAssessmentHistory, retakeInfo } from '../hooks/useAssessmentHistory.js'
import { useContent } from '../hooks/useContent.js'

export default function Assessments() {
  // Data shape: { assessments: [ { id, title, subtitle, color, bg, icon, ... } ] }
  const assessmentsFile = useContent('assessments')
  const assessments = assessmentsFile?.assessments ?? []

  const navigate = useNavigate()
  const { getRecord } = useAssessmentHistory()

  const hasData = assessments.length > 0

  return (
    <div className="page-enter">
      <PageHeader title="Assessments" subtitle="Quick, private check-ins on how you're doing" />

      <div className="px-5 pt-4 pb-6">
        {!hasData ? (
          <EmptyState
            title="Your check-ins are on their way"
            message="Assessments load from assessments.json. Once they're added, you'll find short, validated screens here to help you understand how you're really doing."
          />
        ) : (
          <>
            <p className="mb-4 text-[14px] leading-relaxed text-gray-600">
              Each one is short, confidential, and stays on your device. They're a way to check in
              — not a diagnosis.
            </p>
            <motion.div
              variants={listContainer}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 gap-4 lg:grid-cols-2"
            >
              {assessments.map((a, i) => {
                const record = getRecord(a.id)
                const retake = retakeInfo(record, a.retake_after_days)
                return (
                  <motion.div
                    key={a.id}
                    variants={listItem}
                    // Bento: feature the first check-in as a full-width tile on desktop.
                    className={i === 0 ? 'lg:col-span-2' : undefined}
                  >
                    <AssessmentCard
                      assessment={a}
                      record={record}
                      retake={retake}
                      onOpen={(id) => navigate(`/assessments/${id}`)}
                    />
                  </motion.div>
                )
              })}
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
