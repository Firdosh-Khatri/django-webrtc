# chat/consumers.py

from channels.generic.websocket import AsyncWebsocketConsumer
import json
import logging
import uuid

logger = logging.getLogger(__name__)

# In-memory stores
connected_users = {}   # user_id -> username
user_channels = {}     # user_id -> channel_name
room_users = {}        # room_name -> list of user_ids


class VideoChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        try:
            self.room_name = self.scope['url_route']['kwargs']['room_name']
            self.room_group_name = f'video_chat_{self.room_name}'

            self.user_id = str(uuid.uuid4())
            self.username = None

            await self.accept()
            logger.info(f"✅ WebSocket connected: {self.user_id}")

            await self.channel_layer.group_add(
                self.room_group_name,
                self.channel_name
            )

            connected_users[self.user_id] = self.username
            user_channels[self.user_id] = self.channel_name

            if self.room_name not in room_users:
                room_users[self.room_name] = []
            if self.user_id not in room_users[self.room_name]:
                room_users[self.room_name].append(self.user_id)

            # Notify client
            await self.send(text_data=json.dumps({
                'type': 'connection_success',
                'user_id': self.user_id,
                'message': 'Connected!'
            }))

            # Send initial participant list to new user
            await self.send_participant_list()

            # Notify others in room
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_join',
                    'user_id': self.user_id,
                    'username': self.username or "Anonymous"
                }
            )

        except Exception as e:
            logger.error(f"❌ Error in connect(): {str(e)}", exc_info=True)
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': f'Connection error: {str(e)}'
            }))
            await self.close()

    async def disconnect(self, close_code):
        try:
            logger.info(f"👋 User {self.user_id} disconnecting")

            if self.user_id in connected_users:
                del connected_users[self.user_id]
            if self.user_id in user_channels:
                del user_channels[self.user_id]

            if self.room_name in room_users:
                if self.user_id in room_users[self.room_name]:
                    room_users[self.room_name].remove(self.user_id)
                    if not room_users[self.room_name]:
                        del room_users[self.room_name]

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_leave',
                    'user_id': self.user_id,
                    'username': self.username or 'Anonymous'
                }
            )

            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

        except Exception as e:
            logger.error(f"❌ Error in disconnect(): {str(e)}", exc_info=True)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            logger.info(f"📩 Message received: {data}")

            msg_type = data.get("type")

            if msg_type == "join":
                self.username = data.get('username', 'Anonymous')
                connected_users[self.user_id] = self.username

                # Ensure user is in room list
                if self.room_name not in room_users:
                    room_users[self.room_name] = []
                if self.user_id not in room_users[self.room_name]:
                    room_users[self.room_name].append(self.user_id)

                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'participant_list',
                        'participants': await self.get_room_participants()
                    }
                )

            elif msg_type == "offer":
                to_id = data.get('to')
                if to_id in user_channels:
                    await self.channel_layer.send(
                        user_channels[to_id],
                        {
                            'type': 'offer',
                            'offer': data['offer'],
                            'from': self.user_id,
                            'from_username': self.username
                        }
                    )

            elif msg_type == "answer":
                to_id = data.get('to')
                if to_id in user_channels:
                    await self.channel_layer.send(
                        user_channels[to_id],
                        {
                            'type': 'answer',
                            'answer': data['answer'],
                            'from': self.user_id,
                            'from_username': self.username
                        }
                    )

            elif msg_type == "ice_candidate":
                to_id = data.get('to')
                if to_id in user_channels:
                    await self.channel_layer.send(
                        user_channels[to_id],
                        {
                            'type': 'ice_candidate',
                            'candidate': data['candidate'],
                            'from': self.user_id,
                            'from_username': self.username
                        }
                    )

            elif msg_type == "chat_message":
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'chat_message',
                        'message': data['message'],
                        'from': self.user_id,
                        'from_username': self.username
                    }
                )

            elif msg_type == "recording":
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'recording_status',
                        'status': data['status'],
                        'by': self.username or 'Unknown'
                    }
                )

        except Exception as e:
            logger.error(f"❌ Error in receive(): {str(e)}", exc_info=True)
            await self.send(text_data=json.dumps({
                'type': 'error',
                'message': f'Receive error: {str(e)}'
            }))

    # Handlers

    async def send_participant_list(self):
        participants = await self.get_room_participants()
        await self.send(text_data=json.dumps({
            'type': 'participant_list',
            'participants': participants
        }))

    async def get_room_participants(self):
        users = []
        for user_id in room_users.get(self.room_name, []):
            users.append({
                'user_id': user_id,
                'username': connected_users.get(user_id, 'Anonymous')
            })
        logger.info(f"👥 Room {self.room_name} participants: {users}")
        return users

    async def user_join(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_joined',
            'user_id': event['user_id'],
            'username': event['username']
        }))

    async def user_leave(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'user_id': event['user_id'],
            'username': event['username']
        }))

    async def participant_list(self, event):
        await self.send(text_data=json.dumps({
            'type': 'participant_list',
            'participants': event['participants']
        }))

    async def offer(self, event):
        await self.send(text_data=json.dumps({
            'type': 'offer',
            'offer': event['offer'],
            'from': event['from'],
            'from_username': event['from_username']
        }))

    async def answer(self, event):
        await self.send(text_data=json.dumps({
            'type': 'answer',
            'answer': event['answer'],
            'from': event['from'],
            'from_username': event['from_username']
        }))

    async def ice_candidate(self, event):
        await self.send(text_data=json.dumps({
            'type': 'ice_candidate',
            'candidate': event['candidate'],
            'from': event['from'],
            'from_username': event['from_username']
        }))

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
            'from_username': event['from_username']
        }))

    async def recording_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'recording',
            'status': event['status'],
            'by': event['by']
        }))
