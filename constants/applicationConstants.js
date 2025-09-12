const VISA_TYPES = {
    WORK: 'work',
    PARTNER: 'partner',
    STUDENT: 'student',
    RESIDENCE: 'residence',
    VISITOR: 'visitor',
    BUSINESS: 'business'
};

const STAGES = {
    CONSULTATION: 'consultation',
    DEPOSIT_PAID: 'deposit_paid',
    DOCUMENTS_COMPLETED: 'documents_completed',
    ADDITIONAL_DOCS_REQUIRED: 'additional_docs_required',
    SUBMITTED_TO_INZ: 'submitted_to_inz',
    INZ_PROCESSING: 'inz_processing',
    RFI_RECEIVED: 'rfi_received',
    PPI_RECEIVED: 'ppi_received',
    DECISION: 'decision'
};

const DOCUMENT_TYPES = {
    PASSPORT: 'passport',
    PHOTO: 'photo',
    JOB_OFFER: 'job_offer',
    EMPLOYMENT_CONTRACT: 'employment_contract',
    FINANCIAL_RECORDS: 'financial_records',
    BANK_STATEMENTS: 'bank_statements',
    POLICE_CLEARANCE: 'police_clearance',
    MEDICAL_CERTIFICATE: 'medical_certificate',
    QUALIFICATION_DOCUMENTS: 'qualification_documents',
    MARRIAGE_CERTIFICATE: 'marriage_certificate',
    BIRTH_CERTIFICATE: 'birth_certificate',
    OTHER: 'other'
};

module.exports = {
    VISA_TYPES,
    STAGES,
    DOCUMENT_TYPES
};
