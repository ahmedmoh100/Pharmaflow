import os
import threading
import queue
import pymysql
import pymysql.cursors
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "")


def _parse_url(url: str) -> dict:
    """
    Parse mysql+pymysql://user:password@host:port/database into a dict.
    PyMySQL does not accept the SQLAlchemy-style URL directly.
    """
    url = url.replace("mysql+pymysql://", "")
    user_pass, rest = url.split("@", 1)
    host_port, database = rest.split("/", 1)

    if ":" in user_pass:
        user, password = user_pass.split(":", 1)
    else:
        user, password = user_pass, ""

    if ":" in host_port:
        host, port_str = host_port.split(":", 1)
        port = int(port_str)
    else:
        host, port = host_port, 3306

    return {"host": host, "port": port, "user": user, "password": password, "database": database}


class PyMySQLConnectionPool:
    """
    Thread-safe connection pool for PyMySQL.
    Recycles active connections and creates new ones up to max_size.
    """
    def __init__(self, max_size: int = 20):
        self.max_size = max_size
        self._pool = queue.Queue(maxsize=max_size)
        self._lock = threading.Lock()
        self._created_count = 0
        self._params = _parse_url(DATABASE_URL)

    def _create_new_connection(self) -> pymysql.connections.Connection:
        return pymysql.connect(
            host=self._params["host"],
            port=self._params["port"],
            user=self._params["user"],
            password=self._params["password"],
            database=self._params["database"],
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=False,
        )

    def get_connection(self) -> pymysql.connections.Connection:
        try:
            conn = self._pool.get_nowait()
            try:
                conn.ping(reconnect=True)
                return conn
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
                return self._create_new_connection()
        except queue.Empty:
            with self._lock:
                if self._created_count < self.max_size:
                    self._created_count += 1
                    return self._create_new_connection()
            # If at capacity, wait for a returned connection
            conn = self._pool.get(timeout=10)
            conn.ping(reconnect=True)
            return conn

    def release_connection(self, conn: pymysql.connections.Connection):
        try:
            if conn and conn.open:
                conn.rollback()  # Reset any uncommitted state
                self._pool.put_nowait(conn)
            else:
                with self._lock:
                    self._created_count = max(0, self._created_count - 1)
        except queue.Full:
            try:
                conn.close()
            except Exception:
                pass
            with self._lock:
                self._created_count = max(0, self._created_count - 1)


# Global connection pool instance
_pool = PyMySQLConnectionPool(max_size=20)


def get_connection() -> pymysql.connections.Connection:
    """Acquire a connection from the pool."""
    return _pool.get_connection()


def release_connection(conn: pymysql.connections.Connection):
    """Release a connection back to the pool."""
    _pool.release_connection(conn)


def get_db():
    """
    FastAPI dependency that borrows a pooled connection and returns it after request.
    """
    conn = _pool.get_connection()
    try:
        yield conn
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        _pool.release_connection(conn)


