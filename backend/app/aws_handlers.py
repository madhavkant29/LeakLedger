from mangum import Mangum
from app.main import app

api_handler = Mangum(app)
