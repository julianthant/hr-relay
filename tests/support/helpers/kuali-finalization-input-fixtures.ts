export function kualiFinalizationVariablesInput() {
return {
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  timekeeperName: "Julian Zaw",
  lastDayWorked: "06/09/2026",
  separationDate: "06/10/2026",
  terminationEffectiveDate: "06/11/2026",
  transactionNumber: "T002209631",
  timekeeperComments: "Termination effective date set from the reconciled separation date.",
  observedExistingComments: "",
};
}

export function unfinalizedKualiFieldsInput() {
return {
  department: "- - -",
  payrollTitleCode: "",
  payrollTitle: "",
  requestAcknowledged: false,
  timekeeperName: "",
  lastDayWorked: "",
  separationDate: "",
  terminationEffectiveDate: "",
  submittedTerminationTemplate: false,
  transactionNumber: "",
  finalPay: null,
  timekeeperComments: "",
};
}
