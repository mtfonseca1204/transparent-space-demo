import {
  buildBirdsEyeRoutingData,
  type BirdsEyeRoutingWorkerRequest,
  type BirdsEyeRoutingWorkerResponse,
} from "@/lib/birds-eye-routing-model";

self.onmessage = (event: MessageEvent<BirdsEyeRoutingWorkerRequest>) => {
  const { requestId, cards } = event.data;
  try {
    const response: BirdsEyeRoutingWorkerResponse = {
      requestId,
      ok: true,
      data: buildBirdsEyeRoutingData(cards),
    };
    self.postMessage(response);
  } catch (error) {
    const response: BirdsEyeRoutingWorkerResponse = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown routing worker error",
    };
    self.postMessage(response);
  }
};
