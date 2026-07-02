export const formatTaipeiDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

export const formatDateInputValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const taipei = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return taipei.toISOString().slice(0, 16);
};

export const toLocalDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const confidenceLabel = (value?: number | null) => {
  const confidence = typeof value === "number" ? value : 0;
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.6) return "Medium";
  if (confidence > 0) return "Low";
  return "Unknown";
};

export const saleStatusLabel = (status?: string | null) => {
  switch (status) {
    case "upcoming":
      return "Upcoming";
    case "low_confidence":
      return "Low confidence";
    case "missing_sale_time":
      return "Missing sale time";
    case "ignored":
      return "Ignored";
    case "reviewed":
      return "Reviewed";
    default:
      return status || "No sale";
  }
};
