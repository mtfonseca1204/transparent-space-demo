import {
  buildFragilityModel,
  type BirdsEyeFragilityWorkerRequest,
  type BirdsEyeFragilityWorkerResponse,
} from "@/lib/birds-eye-fragility-model";

self.onmessage = (event: MessageEvent<BirdsEyeFragilityWorkerRequest>) => {
  const { requestId, asset, cards } = event.data;
  try {
    const response: BirdsEyeFragilityWorkerResponse = {
      requestId,
      ok: true,
      model: buildFragilityModel(asset, cards),
    };
    self.postMessage(response);
  } catch (error) {
    const response: BirdsEyeFragilityWorkerResponse = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown fragility worker error",
    };
    self.postMessage(response);
  }
};
