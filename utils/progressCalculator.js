const STAGE_PROGRESS = {
    consultation: 10,
    deposit_paid: 20,
    documents_completed: 40,
    additional_docs_required: 35,
    submitted_to_inz: 60,
    inz_processing: 70,
    rfi_received: 75,
    ppi_received: 80,
    decision: 100
};

const calculateProgress = (stage) => {
    return STAGE_PROGRESS[stage] || 0;
};

const calculateStageCompletion = (application, documents) => {
    const totalDocs = documents.filter(doc => doc.isRequired).length;
    const approvedDocs = documents.filter(doc => doc.isRequired && doc.status === 'approved').length;

    return {
        documents: totalDocs > 0 ? Math.round((approvedDocs / totalDocs) * 100) : 0,
        overall: application.progress
    };
};

const getProgressBreakdown = (currentStage) => {
    const stages = [
        { key: 'consultation', label: 'Consultation', description: 'Initial consultation completed' },
        { key: 'deposit_paid', label: 'Deposit Paid', description: 'Service agreement signed and deposit received' },
        { key: 'documents_completed', label: 'Documents Ready', description: 'All required documents uploaded and approved' },
        { key: 'submitted_to_inz', label: 'Submitted to INZ', description: 'Application submitted to Immigration New Zealand' },
        { key: 'inz_processing', label: 'INZ Processing', description: 'Immigration New Zealand is reviewing your application' },
        { key: 'decision', label: 'Decision', description: 'Final decision received from INZ' }
    ];

    return stages.map(stage => ({
        ...stage,
        completed: STAGE_PROGRESS[stage.key] <= STAGE_PROGRESS[currentStage],
        current: stage.key === currentStage
    }));
};

module.exports = { calculateProgress, calculateStageCompletion, getProgressBreakdown };