import { VOICE_PROTOCOL_VERSION } from '../shared/voice-protocol'

/** Read-only public-tunnel check before changing hosted tools. Never print authenticated bodies. */
export async function checkCallbackRuntime(base: string, secret: string): Promise<void> {
  let response: Response
  try {
    response=await fetch(base+'/calls/capabilities',{
      method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json','ngrok-skip-browser-warning':'1'},
      body:'{}',redirect:'error',signal:AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('The callback API is unreachable. Keep the API and ngrok running at NGROK_URL, then retry setup. Hosted configuration was not changed.')
  }
  if(!response.ok)throw new Error('Callback preflight returned HTTP '+response.status+'. '+(response.status===401?'Check that CALLBACK_SECRET matches the running API.':'Pull the current code, publish the database module, restart the API, and keep ngrok running.')+' Hosted configuration was not changed.')
  let value: unknown
  try{value=await response.json()}catch{throw new Error('The callback URL returned a non-JSON page instead of the API. Check ngrok and NGROK_URL. Hosted configuration was not changed.')}
  const capabilities=value && typeof value==='object'?value as Record<string,unknown>:{}
  if(capabilities.assistance_protocol_version!==VOICE_PROTOCOL_VERSION || capabilities.inbound_context!==true || capabilities.sequence_resync!==true)
    throw new Error('The callback API is not running voice protocol '+VOICE_PROTOCOL_VERSION+'. Publish the matching module and restart the API before setup. Hosted configuration was not changed.')
  if(capabilities.inbound_reports_enabled!==true)
    throw new Error('Set INBOUND_REQUESTS=1 on the API and restart it so returning callers can save reports, then retry setup. Hosted configuration was not changed.')
}
