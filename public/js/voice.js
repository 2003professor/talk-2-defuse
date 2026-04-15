// ══════════════════════ Talk 2 Defuse — Voice Chat (WebRTC) ══════════════════════
const VoiceChat = (() => {
  let socket = null;
  let peerConnection = null;
  let localStream = null;
  let remoteAudio = null;
  let analyser = null;
  let analyserData = null;
  let audioCtx = null;
  let mode = 'open-mic'; // 'open-mic' | 'push-to-talk'
  let isMuted = false;
  let isConnected = false;
  let isInitiator = false;
  let connectTimeout = null;
  let remoteDescSet = false;
  let iceCandidateQueue = [];

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Metered TURN servers for NAT traversal across different networks
    { urls: 'turn:a.relay.metered.ca:80', username: 'e0c13f0974b1dc518999f43f', credential: 'DmGWmNHKX68ki3dV' },
    { urls: 'turn:a.relay.metered.ca:80?transport=tcp', username: 'e0c13f0974b1dc518999f43f', credential: 'DmGWmNHKX68ki3dV' },
    { urls: 'turn:a.relay.metered.ca:443', username: 'e0c13f0974b1dc518999f43f', credential: 'DmGWmNHKX68ki3dV' },
    { urls: 'turns:a.relay.metered.ca:443?transport=tcp', username: 'e0c13f0974b1dc518999f43f', credential: 'DmGWmNHKX68ki3dV' },
  ];

  function init(sock) {
    socket = sock;
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    document.body.appendChild(remoteAudio);

    socket.on('voice-offer', async ({ sdp }) => {
      console.log('[Voice] Received offer');
      try {
        // Receiver also needs mic access for two-way audio
        if (!localStream) {
          try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) audioTrack.enabled = mode === 'open-mic' && !isMuted;
          } catch (micErr) {
            console.warn('[Voice] Receiver mic access denied — one-way audio only:', micErr);
          }
        }
        await createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        remoteDescSet = true;
        // Flush queued ICE candidates
        while (iceCandidateQueue.length > 0) {
          const c = iceCandidateQueue.shift();
          await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        }
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('voice-answer', { sdp: peerConnection.localDescription });
        console.log('[Voice] Sent answer');
        updateUI();
      } catch (e) { console.warn('[Voice] Offer handling failed:', e); }
    });

    socket.on('voice-answer', async ({ sdp }) => {
      console.log('[Voice] Received answer');
      try {
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
        remoteDescSet = true;
        // Flush queued ICE candidates
        while (iceCandidateQueue.length > 0) {
          const c = iceCandidateQueue.shift();
          await peerConnection.addIceCandidate(new RTCIceCandidate(c));
        }
      } catch (e) { console.warn('[Voice] Answer handling failed:', e); }
    });

    socket.on('voice-ice', async ({ candidate }) => {
      if (!candidate) return;
      // Queue if peer connection isn't ready or remote description not set yet
      if (!peerConnection || !remoteDescSet) {
        console.log('[Voice] Queuing ICE candidate (remote desc not set yet)');
        iceCandidateQueue.push(candidate);
        return;
      }
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) { console.warn('[Voice] ICE candidate failed:', e); }
    });

    socket.on('voice-hangup', () => { hangup(true); updateUI(); });
  }

  async function createPeerConnection() {
    if (peerConnection) peerConnection.close();
    remoteDescSet = false;
    peerConnection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 4,
      iceTransportPolicy: 'all',
    });

    peerConnection.onicecandidate = (e) => {
      if (e.candidate) socket.emit('voice-ice', { candidate: e.candidate });
    };

    peerConnection.ontrack = (e) => {
      console.log('[Voice] Received remote track');
      remoteAudio.srcObject = e.streams[0];
      try {
        if (audioCtx) { audioCtx.close().catch(() => {}); }
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(e.streams[0]);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyserData = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
      } catch (_) {}
    };

    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      const state = peerConnection.connectionState;
      console.log('[Voice] Connection state:', state);
      isConnected = state === 'connected';
      if (state === 'connected' && connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
      if (state === 'failed') {
        showVoiceError('Connection failed — try again');
        hangup();
      }
      updateUI();
    };

    peerConnection.oniceconnectionstatechange = () => {
      if (!peerConnection) return;
      console.log('[Voice] ICE state:', peerConnection.iceConnectionState);
    };

    if (localStream) {
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }
  }

  async function startCall() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = mode === 'open-mic' && !isMuted;
      }

      isInitiator = true;
      iceCandidateQueue = [];
      if (connectTimeout) clearTimeout(connectTimeout);
      await createPeerConnection();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('voice-offer', { sdp: peerConnection.localDescription });
      console.log('[Voice] Sent offer');
      // 30s timeout — TURN relay can take a while
      connectTimeout = setTimeout(() => {
        if (!isConnected && peerConnection) {
          console.warn('[Voice] Connection timed out after 30s');
          showVoiceError('Connection timed out — try again');
          hangup();
        }
      }, 30000);
      updateUI();
    } catch (e) {
      console.warn('[Voice] Microphone access denied or failed:', e);
      showVoiceError('Microphone access denied');
    }
  }

  function hangup(remote) {
    if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; analyser = null; analyserData = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    isConnected = false;
    isInitiator = false;
    remoteDescSet = false;
    iceCandidateQueue = [];
    if (!remote) socket.emit('voice-hangup');
    updateUI();
  }

  function toggleMute() {
    isMuted = !isMuted;
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) track.enabled = !isMuted && (mode === 'open-mic');
    }
    updateUI();
  }

  function setMode(newMode) {
    mode = newMode;
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) track.enabled = mode === 'open-mic' && !isMuted;
    }
    updateUI();
  }

  function setPTT(active) {
    if (mode !== 'push-to-talk' || !localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (track) track.enabled = active && !isMuted;
    updateUI();
  }

  function getVoiceActivity() {
    if (!analyser || !analyserData) return 0;
    analyser.getByteFrequencyData(analyserData);
    let sum = 0;
    for (let i = 0; i < analyserData.length; i++) sum += analyserData[i];
    return sum / (analyserData.length * 255);
  }

  function showVoiceError(msg) {
    const el = document.getElementById('voice-status');
    if (el) { el.textContent = msg; el.style.color = 'var(--accent-red)'; }
  }

  function updateUI() {
    const panel = document.getElementById('voice-panel');
    if (!panel) return;

    const micBtn = document.getElementById('voice-mic-btn');
    const muteBtn = document.getElementById('voice-mute-btn');
    const modeBtn = document.getElementById('voice-mode-btn');
    const statusEl = document.getElementById('voice-status');

    if (micBtn) {
      micBtn.textContent = isConnected || localStream ? '🎤 End' : '🎤 Call';
      micBtn.classList.toggle('voice-active', !!(isConnected || localStream));
    }
    if (muteBtn) {
      muteBtn.textContent = isMuted ? '🔇' : '🔊';
      muteBtn.style.display = localStream ? '' : 'none';
    }
    if (modeBtn) {
      modeBtn.textContent = mode === 'open-mic' ? 'Open Mic' : 'PTT';
      modeBtn.style.display = localStream ? '' : 'none';
    }
    if (statusEl) {
      if (isConnected && mode === 'push-to-talk') { statusEl.textContent = 'PTT: Hold Space to talk'; statusEl.style.color = 'var(--accent-blue)'; }
      else if (isConnected) { statusEl.textContent = 'Connected'; statusEl.style.color = 'var(--accent-green)'; }
      else if (localStream) { statusEl.textContent = 'Connecting...'; statusEl.style.color = 'var(--accent-yellow)'; }
      else { statusEl.textContent = ''; statusEl.style.color = ''; }
    }
  }

  return {
    init, startCall, hangup, toggleMute, setMode, setPTT,
    getVoiceActivity, updateUI,
    get isConnected() { return isConnected; },
    get isMuted() { return isMuted; },
    get mode() { return mode; },
    get hasStream() { return !!localStream; },
  };
})();
