"""Coupon and CouponUsage SQLAlchemy models."""
from sqlalchemy import Column, String, Enum, Numeric, DateTime, Date, Integer, Boolean, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime, date
from app.db import Base

class Coupon(Base):
    __tablename__ = "coupons"
    
    id = Column(String(36), primary_key=True)
    code = Column(String(30), unique=True, nullable=False, index=True)
    type = Column(Enum('employee', 'promotional'), nullable=False, index=True)
    discount_type = Column(Enum('percentage', 'fixed'), nullable=False)
    discount_value = Column(Numeric(12, 3), nullable=False)
    description_en = Column(String(200), default='')
    description_ar = Column(String(200), default='')
    applies_to = Column(Enum('all_items', 'category', 'medicine'), default='all_items')
    applies_to_id = Column(String(36), nullable=True)  # category code or medicine_id
    valid_from = Column(Date, nullable=True)
    valid_until = Column(Date, nullable=True)
    max_uses = Column(Integer, nullable=True)  # NULL = unlimited
    usage_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True, index=True)
    created_by = Column(String(36), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    usages = relationship("CouponUsage", back_populates="coupon")


class CouponUsage(Base):
    __tablename__ = "coupon_usage"
    
    id = Column(String(36), primary_key=True)
    coupon_id = Column(String(36), ForeignKey("coupons.id"), nullable=False, index=True)
    sale_id = Column(String(36), ForeignKey("sales.id"), nullable=False, index=True)
    discount_amount = Column(Numeric(12, 3), nullable=False)  # Actual discount applied in SAR
    used_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    coupon = relationship("Coupon", back_populates="usages")
