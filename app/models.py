from typing import Optional

from pydantic import BaseModel


class UploadResponse(BaseModel):
    id: str
    number: Optional[str]
    image_url: str


class ImageRecord(BaseModel):
    id: str
    number: Optional[str]
    image_url: str
    public_id: str
    created_at: str
