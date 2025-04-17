const videoGrid = document.getElementById("video-grid");
const localVideo = document.createElement("video");
localVideo.muted = true;
let peerConnections = {};
let localStream;
let socket;
let userId = null;
let maxActiveConnections = 15;
let connectionQueue = [];

// Get room ID and username from the page
// These variables are set in the room.html template
console.log("Room ID:", roomId);
console.log("Username:", username);

function initializeWebSocket() {
    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws/video_chat/${roomId}/`;
        console.log("Connecting to WebSocket:", wsUrl);

        socket = new WebSocket(wsUrl);

        socket.onopen = function(e) {
            console.log("WebSocket connection established");
            if (!userId) {
                userId = 'user_' + Math.random().toString(36).substr(2, 9);
                console.log("Generated user ID:", userId);
            }

            // Send join message immediately after connection
            socket.send(JSON.stringify({
                'type': 'join',
                'room': roomId,
                'user_id': userId,
                'username': username
            }));
        };

        socket.onclose = function(event) {
            console.log("WebSocket connection closed", event.code, event.reason);
            // Attempt to reconnect after a delay
            setTimeout(initializeWebSocket, 3000);
        };

        socket.onerror = function(error) {
            console.error("WebSocket error:", error);
        };

        socket.onmessage = function(e) {
            try {
                const data = JSON.parse(e.data);
                console.log('Received message:', data);

                switch(data.type) {
                    case 'connection_success':
                        console.log('Connection successful, user ID:', data.user_id);
                        userId = data.user_id;
                        break;

                    case 'participant_list':
                        console.log('Received participant list:', data.participants);
                        updateParticipantList(data.participants);
                        // Attempt to connect to all users in the list upon joining
                        data.participants.forEach(participant => {
                            if (participant.user_id !== userId && !peerConnections[participant.user_id]) {
                                console.log("Attempting connection to participant:", participant.user_id);
                                createPeerConnection(participant.user_id);
                            }
                        });
                        break;

                    case 'user_join':
                        console.log('User joined:', data.user_id);
                        addParticipant(data.user_id, data.username);
                        if (data.user_id !== userId && !peerConnections[data.user_id]) {
                            createPeerConnection(data.user_id);
                        }
                        break;

                    case 'user_leave':
                        console.log('User left:', data.user_id);
                        removeParticipant(data.user_id);
                        if (peerConnections[data.user_id]) {
                            peerConnections[data.user_id].close();
                            delete peerConnections[data.user_id];
                        }
                        break;

                    case 'offer':
                        handleOffer(data.from, data.offer, data.from_username);
                        break;

                    case 'answer':
                        handleAnswer(data.from, data.answer);
                        break;

                    case 'ice_candidate':
                        handleIceCandidate(data.from, data.candidate);
                        break;

                    case 'chat_message':
                        handleChatMessage(data);
                        break;

                    case 'error':
                        console.error('WebSocket error:', data.message);
                        break;
                }
            } catch (error) {
                console.error("Error processing message:", error, e.data);
            }
        };
    } catch (error) {
        console.error("Error initializing WebSocket:", error);
    }
}

// Initialize WebSocket connection when the page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeWebSocket();
});

navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
}).then(stream => {
    console.log("Media access granted:", stream);
    localStream = stream;
    addVideoStream(localVideo, stream);
}).catch(error => {
    console.error("Error accessing media devices:", error);
    alert("Could not access your camera and microphone. Please check permissions and try again.");
});

function addVideoStream(video, stream) {
    video.srcObject = stream;
    video.addEventListener("loadedmetadata", () => {
        video.play().catch(e => console.error("Error playing video:", e)); //Handle autoplay
    });
    videoGrid.append(video);
    console.log("Video stream added to grid");
}

function createPeerConnection(remoteUserId) {
    console.log('Creating peer connection for user:', remoteUserId);
    if (peerConnections[remoteUserId]) {
        console.warn(`Peer connection for ${remoteUserId} already exists.  Re-using.`);
        return; //  Important:  Do NOT create a new PC if one exists!
    }

    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
           // { urls: 'turn:your-turn-server.com:3478', username: 'yourusername', credential: 'yourpassword' } //Add TURN
        ]
    });

    peerConnections[remoteUserId] = peerConnection;

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            console.log("Sending ICE candidate to", remoteUserId, event.candidate);
            socket.send(JSON.stringify({
                type: 'ice_candidate',
                candidate: event.candidate,
                to: remoteUserId,
                from: userId,
                from_username: username
            }));
        } else {
           // console.log("ICE gathering complete for", remoteUserId);  // Don't log completion here, can be noisy
        }
    };

    peerConnection.ontrack = event => {
        console.log('Received remote track from:', remoteUserId);
        let remoteVideo = document.getElementById(`video-${remoteUserId}`);
        if (!remoteVideo)
        {
            remoteVideo = document.createElement('video');
            remoteVideo.id = `video-${remoteUserId}`;
            remoteVideo.autoplay = true;
            remoteVideo.muted = false;
            addVideoStream(remoteVideo, event.streams[0]);
        }
        else
        {
             addVideoStream(remoteVideo, event.streams[0]);
        }
    };
    peerConnection.onconnectionstatechange = (event) => {  //monitor connection state
      console.log(`PC State change for ${remoteUserId}: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === 'failed' ||
          peerConnection.connectionState === 'disconnected' ||
          peerConnection.connectionState === 'closed') {
          console.error(`Connection to ${remoteUserId} failed.  Cleaning up.`);
          delete peerConnections[remoteUserId];
          const videoElement = document.getElementById(`video-${remoteUserId}`);
          if (videoElement) {
              videoElement.remove();
          }
           if (connectionQueue.length > 0) {
                const nextUserId = connectionQueue.shift();
                console.log(`Processing queued connection to ${nextUserId}`);
                createPeerConnection(nextUserId);
            }
      }
    };

    peerConnection.createOffer()
        .then(offer => {
            console.log("Created offer for", remoteUserId, offer);
            return peerConnection.setLocalDescription(offer);
        })
        .then(() => {
            console.log("Sending offer to", remoteUserId, peerConnection.localDescription);
            socket.send(JSON.stringify({
                type: 'offer',
                offer: peerConnection.localDescription,
                to: remoteUserId,
                from: userId,
                from_username: username
            }));
        })
        .catch(error => {
            console.error('Error creating offer:', error);
        });
    return peerConnection;
}

function handleOffer(remoteUserId, offer, remoteUsername) {  // Added remoteUsername
    console.log('Handling offer from:', remoteUserId, remoteUsername);

    if (!peerConnections[remoteUserId]) {
        createPeerConnection(remoteUserId);
    }
    const peerConnection = peerConnections[remoteUserId];

    peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
        .then(() => {
            console.log("Set remote description for", remoteUserId);
            return peerConnection.createAnswer();
        })
        .then(answer => {
            console.log("Created answer for", remoteUserId, answer);
            return peerConnection.setLocalDescription(answer);
        })
        .then(() => {
            console.log("Sending answer to", remoteUserId, peerConnection.localDescription);
            socket.send(JSON.stringify({
                type: 'answer',
                answer: peerConnection.localDescription,
                to: remoteUserId,
                from: userId,
                from_username: username
            }));
        })
        .catch(error => {
            console.error('Error handling offer:', error);
        });
}

function handleAnswer(remoteUserId, answer) {
    console.log('Handling answer from:', remoteUserId);
    if (!peerConnections[remoteUserId]) {
        console.error(`No peer connection for ${remoteUserId} to handle answer!`);
        return;
    }
    const peerConnection = peerConnections[remoteUserId];
    peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
        .then(() => {
            console.log("Set remote description (answer) for", remoteUserId);
        })
        .catch(error => {
            console.error('Error handling answer:', error);
        });
}

function handleIceCandidate(remoteUserId, candidate) {
    console.log('Handling ICE candidate from:', remoteUserId);
     if (!peerConnections[remoteUserId]) {
        console.warn(`Received ICE candidate for unknown peer ${remoteUserId}.  Ignoring.`);
        return;
    }
    const peerConnection = peerConnections[remoteUserId];
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => {
            console.log("Added ICE candidate for", remoteUserId);
        })
        .catch(error => {
            console.error('Error handling ICE candidate:', error);
        });
}

function toggleMute() {
    if (!localStream) {
        console.error("No local stream available");
        return;
    }
    const tracks = localStream.getAudioTracks();
    if (tracks.length > 0) {
        tracks[0].enabled = !tracks[0].enabled;
        console.log("Audio track enabled:", tracks[0].enabled);
    } else {
        console.error("No audio tracks found");
    }
}

function toggleVideo() {
    if (!localStream) {
        console.error("No local stream available");
        return;
    }
    const tracks = localStream.getVideoTracks();
    if (tracks.length > 0) {
        tracks[0].enabled = !tracks[0].enabled;
        console.log("Video track enabled:", tracks[0].enabled);
    } else {
        console.error("No video tracks found");
    }
}

function updateParticipantList(participants) {
    const participantList = document.getElementById('participantList');
    participantList.innerHTML = '';
    
    participants.forEach(participant => {
        const participantElement = document.createElement('div');
        participantElement.className = 'participant';
        participantElement.id = `participant-${participant.user_id}`;
        participantElement.innerHTML = `
            <span class="participant-name">${participant.username || 'Anonymous'}</span>
            <span class="participant-status">Connecting...</span>
        `;
        participantList.appendChild(participantElement);
    });

    // Update participant count
    const participantCount = document.getElementById('participantCount');
    if (participantCount) {
        participantCount.textContent = participants.length;
    }
}

function addParticipant(userId, username) {
    const participantList = document.getElementById('participantList');
    const existingParticipant = document.getElementById(`participant-${userId}`);
    
    if (!existingParticipant) {
        const participantElement = document.createElement('div');
        participantElement.className = 'participant';
        participantElement.id = `participant-${userId}`;
        participantElement.innerHTML = `
            <span class="participant-name">${username || 'Anonymous'}</span>
            <span class="participant-status">Connecting...</span>
        `;
        participantList.appendChild(participantElement);

        // Update participant count
        const participantCount = document.getElementById('participantCount');
        if (participantCount) {
            const currentCount = parseInt(participantCount.textContent) || 0;
            participantCount.textContent = currentCount + 1;
        }
    }
}

function removeParticipant(userId) {
    const participantElement = document.getElementById(`participant-${userId}`);
    if (participantElement) {
        participantElement.remove();

        // Update participant count
        const participantCount = document.getElementById('participantCount');
        if (participantCount) {
            const currentCount = parseInt(participantCount.textContent) || 0;
            participantCount.textContent = Math.max(0, currentCount - 1);
        }
    }
}

function showRecordingNotification(status, by) {
    const msg = status === 'start'
        ? `📹 Recording started by ${by}`
        : `🛑 Recording stopped by ${by}`;
    alert(msg);
}

function toggleRecording(isRecording) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not open");
        alert("Connection lost. Please refresh the page.");
        return;
    }
    socket.send(JSON.stringify({ action: "recording", status: isRecording ? "start" : "stop" }));
}

function leaveRoom() {
    console.log("Leaving room...");
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    Object.values(peerConnections).forEach(pc => {
        pc.close();
    });
    peerConnections = {};
    if (socket) {
        socket.close();
    }
    window.location.href = '/';
}
