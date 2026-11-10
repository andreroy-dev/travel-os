from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.schemas import ChatIn, ChatOut
from app.services.assistant import reply

router = APIRouter()


@router.post("/ai/chat", response_model=ChatOut)
def chat(payload: ChatIn, user: CurrentUser, session: DbSession) -> dict:
    return reply(
        session,
        user,
        payload.message.strip(),
        payload.travel_space_id,
        payload.conversation_id,
    )
